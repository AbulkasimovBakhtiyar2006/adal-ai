import asyncio
import hmac
import json
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.admin import audio_response, install_admin
from app.config import Settings
from app.corpus import is_fresh, load_corpus
from app.games import GameRooms
from app.library import Library
from app.models import AskRequest, AskResponse
from app.providers import LiveProviders, Providers
from app.retrieval import Retriever
from app.service import AnswerService
from app.storage import read_settings
from app.speech import SpeechLimits
from app.web import HistoryStore, install_web

logger = logging.getLogger("adal")


def create_app(settings: Settings | None = None, providers: Providers | None = None) -> FastAPI:
    settings = settings or read_settings(Settings())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        chunks = load_corpus(settings.corpus_path, settings.allowed_source_hosts)
        library = Library(settings)
        chunks += library.active_chunks()
        async with httpx.AsyncClient(
            timeout=settings.provider_timeout_seconds, follow_redirects=False, trust_env=False
        ) as client:
            app.state.settings = settings
            app.state.library = library
            app.state.http = client
            app.state.provider_override = providers
            app.state.mutation_lock = asyncio.Lock()
            app.state.upload_slots = asyncio.Semaphore(2)
            app.state.collection_task = None
            app.state.history = HistoryStore(settings.runtime_dir / "chat.sqlite3")
            app.state.busy_sessions = set()
            app.state.games = GameRooms()
            app.state.speech_limits = SpeechLimits()
            report_path = settings.library_dir / "collection-report.json"
            app.state.collection = (
                json.loads(report_path.read_text()) if report_path.exists() else {"status": "idle"}
            )
            app.state.service = AnswerService(
                settings,
                Retriever(chunks, settings.source_max_age_days),
                providers or LiveProviders(settings, client),
            )
            app.state.slots = asyncio.Semaphore(settings.max_concurrent_requests)
            try:
                yield
            finally:
                if app.state.collection_task and not app.state.collection_task.done():
                    app.state.collection_task.cancel()
                    await asyncio.gather(app.state.collection_task, return_exceptions=True)

    app = FastAPI(
        title="Adal AI",
        version="0.1.0",
        lifespan=lifespan,
        description="Document answers released only after three mandatory checks.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        # FastAPI's default errors echo input; keep user text out of diagnostics.
        return JSONResponse(status_code=422, content={"detail": "invalid_request"})

    async def authenticate(request: Request, authorization: str | None = Header(default=None)):
        expected = request.app.state.settings.backend_api_key.get_secret_value()
        if expected and not hmac.compare_digest(authorization or "", f"Bearer {expected}"):
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/ready", dependencies=[Depends(authenticate)])
    async def ready(request: Request):
        chunks = request.app.state.service.retriever.chunks
        effective = request.app.state.settings
        fresh = [c for c in chunks if is_fresh(c, effective.source_max_age_days)]
        missing = effective.missing_configuration()
        languages = sorted({c.language for c in fresh})
        configured = not missing and languages == ["kk", "ru"]
        return JSONResponse(
            status_code=200 if configured else 503,
            content={
                "status": "configured" if configured else "not_configured",
                "fresh_chunks": len(fresh),
                "languages": languages,
                "missing_configuration": missing,
                "external_connectivity": "not_tested",
                "thresholds_calibrated": False,
            },
        )

    @app.post("/api/ask", response_model=AskResponse, dependencies=[Depends(authenticate)])
    async def ask(body: AskRequest, request: Request):
        slots = request.app.state.slots
        # Single event loop: check/acquire has no suspension while a slot is available.
        if slots.locked():
            raise HTTPException(status_code=429, detail="busy", headers={"Retry-After": "5"})
        async with slots:
            request_id = str(uuid.uuid4())
            response = await request.app.state.service.ask(body, request_id)
            logger.info(
                "request_id=%s status=%s attempts=%d",
                request_id,
                response.status,
                response.verification.attempts,
            )
            return JSONResponse(
                status_code=503 if response.status == "temporarily_unavailable" else 200,
                content=response.model_dump(mode="json"),
                headers={"Cache-Control": "no-store", "X-Request-ID": request_id},
            )

    @app.post("/api/audio/transcribe", dependencies=[Depends(authenticate)])
    async def transcribe_audio(request: Request, file: Annotated[UploadFile, File()]):
        return await audio_response(request, file)

    install_admin(app, ask)
    install_web(app, authenticate, ask)
    return app


app = create_app()
