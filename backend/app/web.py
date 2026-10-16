"""Browser chat adapter: cookie sessions, private history, real verification pipeline."""

import asyncio
import hashlib
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from app.models import AskRequest

COOKIE = "adal_session"
TTL = 7 * 86400
DIST = Path(__file__).resolve().parents[2] / "frontend/adal-ai/frontend/dist"


class PortalFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path in {".", "", "index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}:
            response.headers["Cache-Control"] = "no-cache"
        return response


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    message: str = Field(max_length=2000)
    lang: Literal["ru", "kk"]
    client_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")


class HistoryStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS turns (
                    session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    client_id TEXT NOT NULL, question TEXT NOT NULL, lang TEXT NOT NULL,
                    reply TEXT NOT NULL, created REAL NOT NULL,
                    PRIMARY KEY (session, client_id)
                );
            """)
        path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("PRAGMA foreign_keys=ON")
            with db:
                yield db
        finally:
            db.close()

    def session(self, token: str | None):
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            key = hashlib.sha256((token or "").encode()).hexdigest()
            if token and db.execute("SELECT 1 FROM sessions WHERE id=?", (key,)).fetchone():
                return key, None
            token = secrets.token_urlsafe(32)
            key = hashlib.sha256(token.encode()).hexdigest()
            db.execute("INSERT INTO sessions VALUES (?, ?)", (key, time.time() + TTL))
            return key, token

    def history(self, key):
        with self.connect() as db:
            rows = db.execute(
                "SELECT client_id, question, reply FROM turns WHERE session=? ORDER BY created",
                (key,),
            ).fetchall()
        return [
            {"id": cid, "question": question, **json.loads(reply)} for cid, question, reply in rows
        ]

    def previous(self, key, client_id):
        with self.connect() as db:
            return db.execute(
                "SELECT question, lang, reply FROM turns WHERE session=? AND client_id=?",
                (key, client_id),
            ).fetchone()

    def save(self, key, body, reply):
        with self.connect() as db:
            db.execute(
                "INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)",
                (
                    key,
                    body.client_id,
                    body.message,
                    body.lang,
                    json.dumps(reply, ensure_ascii=False),
                    time.time(),
                ),
            )
            db.execute(
                """DELETE FROM turns WHERE session=? AND client_id NOT IN (
                SELECT client_id FROM turns WHERE session=? ORDER BY created DESC LIMIT 100
            )""",
                (key, key),
            )

    def clear(self, key, delete_session=False):
        with self.connect() as db:
            if delete_session:
                db.execute("DELETE FROM sessions WHERE id=?", (key,))
            else:
                db.execute("DELETE FROM turns WHERE session=?", (key,))


def error(code: str, status=503):
    return JSONResponse(
        {"error": {"code": code}}, status_code=status, headers={"Cache-Control": "no-store"}
    )


def install_web(app, authenticate, run_ask):
    async def browser_access(request: Request):
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            raise HTTPException(403, "same_origin_required")
        if not request.app.state.settings.public_web_enabled:
            await authenticate(request, request.headers.get("authorization"))

    router = APIRouter(prefix="/api", dependencies=[Depends(browser_access)])

    async def session(request: Request, response: Response):
        store = request.app.state.history
        key, token = await asyncio.to_thread(store.session, request.cookies.get(COOKIE))
        if token:
            response.set_cookie(
                COOKIE,
                token,
                httponly=True,
                samesite="strict",
                secure=request.url.scheme == "https",
                max_age=TTL,
                path="/api",
            )
        response.headers["Cache-Control"] = "no-store"
        return key

    @router.get("/config")
    async def config(response: Response):
        response.headers["Cache-Control"] = "no-store"
        return {"ai_mode": "real", "max_message_chars": 2000}

    @router.get("/history")
    async def history(request: Request, response: Response):
        key = await session(request, response)
        return {"turns": await asyncio.to_thread(request.app.state.history.history, key)}

    @router.post("/chat")
    async def chat(body: ChatRequest, request: Request, response: Response):
        body.message = body.message.strip()
        if len(body.message) < 3:
            return error("MESSAGE_EMPTY", 422)
        key = await session(request, response)
        state = request.app.state
        if key in state.busy_sessions:
            return error("CONVERSATION_BUSY", 409)
        state.busy_sessions.add(key)
        try:
            previous = await asyncio.to_thread(state.history.previous, key, body.client_id)
            if previous:
                if previous[:2] != (body.message, body.lang):
                    return error("AI_BAD_RESPONSE", 409)
                return json.loads(previous[2])
            try:
                result = await run_ask(
                    AskRequest(question=body.message, language=body.lang), request
                )
            except HTTPException as exc:
                if exc.status_code == 429:
                    return error("RATE_LIMITED", 429)
                raise
            answer = json.loads(result.body)
            if answer["status"] == "temporarily_unavailable":
                reasons = answer["verification"]["reason_codes"]
                code = (
                    "AI_NOT_CONFIGURED"
                    if any(
                        r in {"corpus_not_configured", "providers_not_configured"} for r in reasons
                    )
                    else "AI_FAILED"
                )
                return error(code)
            reply = {
                "answer": answer["answer"],
                "ai_mode": "real",
                "status": "answered"
                if answer["status"] == "answered"
                else "insufficient_information",
                "sources": [
                    {
                        "title": s["title"],
                        "url": s["url"],
                        "details": f"{s['section']} · {s['revision']}",
                    }
                    for s in answer["sources"]
                ],
            }
            await asyncio.to_thread(state.history.save, key, body, reply)
            return reply
        finally:
            state.busy_sessions.discard(key)

    async def remove(request, response, delete_session=False):
        key = await session(request, response)
        if key in request.app.state.busy_sessions:
            return error("CONVERSATION_BUSY", 409)
        request.app.state.busy_sessions.add(key)
        try:
            await asyncio.to_thread(request.app.state.history.clear, key, delete_session)
            if delete_session:
                response.delete_cookie(COOKIE, path="/api")
            response.status_code = 204
            return response
        finally:
            request.app.state.busy_sessions.discard(key)

    @router.delete("/history")
    async def clear_history(request: Request, response: Response):
        return await remove(request, response)

    @router.delete("/session")
    async def delete_session(request: Request, response: Response):
        return await remove(request, response, True)

    app.include_router(router)

    if DIST.is_dir():
        # Registered last: API/admin routes remain owned by FastAPI. StaticFiles
        # restricts paths to the build directory and does not expose source/secrets.
        app.mount("/", PortalFiles(directory=DIST, html=True), name="frontend")
    else:

        @app.get("/", include_in_schema=False)
        async def unbuilt():
            return JSONResponse(
                {"detail": "Build frontend with npm run build first."}, status_code=503
            )
