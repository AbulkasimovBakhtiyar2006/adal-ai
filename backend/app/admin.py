import asyncio
import hmac
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, ConfigDict, Field

from app.audio import MAX_AUDIO, AudioError, transcribe
from app.catalog import catalog
from app.collector import collect
from app.corpus import is_fresh, load_corpus
from app.library import Library
from app.models import AskRequest
from app.parsing import MAX_UPLOAD, ParsedText, ParseError, clean_text, parse_file
from app.providers import LiveProviders, ProviderUnavailable
from app.retrieval import Retriever
from app.service import AnswerService
from app.storage import SECRET_FIELDS, public_settings, save_settings

STATIC = Path(__file__).parent / "static"


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    generator_provider: Literal["gemini", "deepseek"] | None = None
    deepseek_api_key: str | None = Field(default=None, max_length=4096)
    deepseek_model: str | None = Field(default=None, min_length=1, max_length=100)
    gemini_api_key: str | None = Field(default=None, max_length=4096)
    gemini_model: str | None = Field(default=None, max_length=100)
    critic_api_key: str | None = Field(default=None, max_length=4096)
    critic_model: str | None = Field(default=None, max_length=100)
    google_cloud_project: str | None = Field(default=None, max_length=100)
    audio_model: str | None = Field(default=None, max_length=100)
    grounding_support_threshold: float | None = Field(default=None, ge=0, le=1)
    grounding_claim_threshold: float | None = Field(default=None, ge=0, le=1)
    grounding_citation_threshold: float | None = Field(default=None, ge=0, le=1)
    clear_keys: list[Literal["deepseek_api_key", "gemini_api_key", "critic_api_key"]] = []


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=1, max_length=2000)
    revision: str = Field(min_length=1, max_length=200)
    language: Literal["ru", "kk"]
    reviewed: Literal[True]


async def admin_auth(request: Request):
    settings = request.app.state.settings
    origin = request.headers.get("origin")
    if origin and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "admin_same_origin_required")
    if request.headers.get("x-adal-admin") != "1":
        raise HTTPException(403, "admin_header_required")
    expected = settings.admin_api_key.get_secret_value()
    if expected:
        if not hmac.compare_digest(request.headers.get("authorization", ""), f"Bearer {expected}"):
            raise HTTPException(401, "admin_unauthorized")
    else:
        peer = request.client.host if request.client else ""
        hostname = urlsplit(str(request.base_url)).hostname
        if peer not in {"127.0.0.1", "::1"} or hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise HTTPException(403, "admin_localhost_only_set_ADMIN_API_KEY_for_remote")


async def read_upload(file: UploadFile, limit: int) -> bytes:
    try:
        data = await file.read(limit + 1)
        if not data or len(data) > limit:
            raise HTTPException(413, "file_empty_or_too_large")
        return data
    finally:
        await file.close()


async def rebuild(request: Request):
    state = request.app.state
    chunks = await asyncio.to_thread(
        load_corpus, state.settings.corpus_path, state.settings.allowed_source_hosts
    )
    chunks += await asyncio.to_thread(state.library.active_chunks)
    state.service = AnswerService(
        state.settings,
        Retriever(chunks, state.settings.source_max_age_days),
        state.provider_override or LiveProviders(state.settings, state.http),
    )


async def audio_response(request: Request, file: UploadFile):
    if request.app.state.slots.locked():
        raise HTTPException(429, "busy")
    async with request.app.state.slots:
        data = await read_upload(file, MAX_AUDIO)
        try:
            async with asyncio.timeout(60):
                return await transcribe(data, request.app.state.settings, request.app.state.http)
        except AudioError as exc:
            raise HTTPException(422, str(exc)) from exc
        except (ProviderUnavailable, TimeoutError) as exc:
            raise HTTPException(503, "audio_unavailable_check_gemini_settings") from exc


def install_admin(app, run_ask):
    @app.get("/admin", response_class=HTMLResponse, include_in_schema=False)
    async def page():
        return FileResponse(
            STATIC / "admin.html",
            media_type="text/html",
            headers={
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; "
                "style-src 'self'; "
                "connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; "
                "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
            },
        )

    @app.get("/admin/assets/{name}", include_in_schema=False)
    async def asset(name: str):
        if name not in {"admin.css", "admin.js", "portal.css", "brand.svg"}:
            raise HTTPException(404)
        return FileResponse(STATIC / name, headers={"X-Content-Type-Options": "nosniff"})

    router = APIRouter(prefix="/admin/api", dependencies=[Depends(admin_auth)])

    @router.get("/status")
    async def status(request: Request):
        state = request.app.state
        records = await asyncio.to_thread(state.library.list)
        chunks = state.service.retriever.chunks
        return {
            "settings": public_settings(state.settings),
            "documents": len(records),
            "active_documents": sum(r["status"] == "active" for r in records),
            "fresh_chunks": sum(is_fresh(c, state.settings.source_max_age_days) for c in chunks),
            "collection": state.collection,
            "catalog_size": len(catalog()),
        }

    @router.patch("/settings")
    async def update_settings(body: SettingsUpdate, request: Request):
        values = body.model_dump(exclude_none=True, exclude={"clear_keys"})
        # Empty password fields mean "keep saved key". Erasure requires an explicit action.
        values = {
            key: value.strip() if key in SECRET_FIELDS else value
            for key, value in values.items()
            if key not in SECRET_FIELDS or value.strip()
        }
        values.update({key: "" for key in body.clear_keys})
        async with request.app.state.mutation_lock:
            try:
                candidate = await asyncio.to_thread(
                    save_settings, request.app.state.settings, values
                )
            except ValueError as exc:
                raise HTTPException(422, "invalid_settings") from exc
            request.app.state.settings = candidate
            request.app.state.library = Library(candidate)
            await rebuild(request)
        return public_settings(candidate)

    @router.post("/check/{provider}")
    async def check_connection(provider: Literal["deepseek", "gemini"], request: Request):
        settings = request.app.state.settings
        if provider == "deepseek":
            key = settings.deepseek_api_key.get_secret_value()
            url, headers = "https://api.deepseek.com/models", {"Authorization": f"Bearer {key}"}
        else:
            key = settings.gemini_api_key.get_secret_value()
            url, headers = (
                "https://generativelanguage.googleapis.com/v1beta/models",
                {"x-goog-api-key": key},
            )
        if not key:
            raise HTTPException(422, "save_api_key_first")
        try:
            response = await request.app.state.http.get(url, headers=headers)
            response.raise_for_status()
            body = response.json()
            models = (
                [m["id"] for m in body["data"]]
                if provider == "deepseek"
                else [m["name"].removeprefix("models/") for m in body["models"]]
            )
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise HTTPException(502, "provider_connection_failed") from exc
        return {"status": "connected", "models": models}

    @router.get("/documents")
    async def documents(request: Request):
        return {"documents": await asyncio.to_thread(request.app.state.library.list)}

    @router.post("/documents")
    async def upload_document(
        request: Request,
        file: Annotated[UploadFile | None, File()] = None,
        text: str = Form(default="", max_length=2_000_000),
        title: str = Form(default="", max_length=300),
        language: Literal["ru", "kk"] = Form(default="ru"),
        url: str = Form(default="", max_length=2000),
        revision: str = Form(default="", max_length=200),
    ):
        if request.app.state.upload_slots.locked():
            raise HTTPException(429, "busy")
        async with request.app.state.upload_slots:
            try:
                if file and file.filename:
                    filename = Path(file.filename).name
                    raw = await read_upload(file, MAX_UPLOAD)
                    parsed = await asyncio.to_thread(parse_file, raw, filename)
                else:
                    raw, filename = text.encode(), "pasted-text.txt"
                    parsed = ParsedText(title or "Загруженный текст", clean_text(text), [])
                    if len(parsed.text) < 30:
                        raise ParseError("text_too_short")
                return await asyncio.to_thread(
                    request.app.state.library.add,
                    parsed,
                    raw,
                    filename,
                    language,
                    title,
                    url,
                    revision,
                )
            except ParseError as exc:
                raise HTTPException(422, str(exc)) from exc

    @router.get("/documents/{record_id}")
    async def document_detail(record_id: str, request: Request):
        try:
            library = request.app.state.library
            record = await asyncio.to_thread(library.get, record_id)
            text = await asyncio.to_thread(library.text, record_id)
            return record | {"text": text}
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(404, "document_not_found") from exc

    @router.get("/documents/{record_id}/original")
    async def original(record_id: str, request: Request):
        try:
            library = request.app.state.library
            record = library.get(record_id)
            return FileResponse(
                library.directory(record_id) / "original.bin",
                filename=record["filename"],
                media_type="application/octet-stream",
            )
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(404, "document_not_found") from exc

    @router.post("/documents/{record_id}/activate")
    async def activate(record_id: str, body: PublishRequest, request: Request):
        async with request.app.state.mutation_lock:
            try:
                result = await asyncio.to_thread(
                    request.app.state.library.publish,
                    record_id,
                    body.title,
                    body.url,
                    body.revision,
                    body.language,
                )
                await rebuild(request)
                return result
            except FileNotFoundError as exc:
                raise HTTPException(404, "document_not_found") from exc
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc

    @router.post("/documents/{record_id}/deactivate")
    async def deactivate(record_id: str, request: Request):
        async with request.app.state.mutation_lock:
            try:
                result = await asyncio.to_thread(request.app.state.library.deactivate, record_id)
                await rebuild(request)
                return result
            except (ValueError, FileNotFoundError) as exc:
                raise HTTPException(404, "document_not_found") from exc

    @router.post("/sources/download")
    async def download(request: Request):
        state = request.app.state
        if state.collection_task and not state.collection_task.done():
            raise HTTPException(409, "collection_already_running")
        state.collection = {"status": "starting"}

        async def run():
            try:
                async with state.mutation_lock:
                    await collect(state.settings, state.collection)
                    await rebuild(request)
            except Exception:
                state.collection["status"] = "failed"

        state.collection_task = asyncio.create_task(run())
        return {"status": "started"}

    @router.post("/audio/transcribe")
    async def audio(request: Request, file: Annotated[UploadFile, File()]):
        return await audio_response(request, file)

    @router.post("/ask")
    async def test_ask(body: AskRequest, request: Request):
        return await run_ask(body, request)

    app.include_router(router)
