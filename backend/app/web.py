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
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from app import browser_auth
from app.chat_language import reply_language
from app.direct_chat import answer as direct_answer
from app.models import AskRequest
from app.providers import InvalidModelOutput, ProviderUnavailable

COOKIE = "adal_session"
TTL = 7 * 86400
DIST = Path(__file__).resolve().parents[2] / "frontend/adal-ai/frontend/dist"


class PortalFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path in {".", "", "index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}:
            response.headers["Cache-Control"] = "no-cache"
        return response


class GuestContextTurn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    question: str = Field(max_length=2000)
    answer: str = Field(max_length=20000)


class GoogleLogin(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    credential: str = Field(min_length=1, max_length=12000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    local_only: bool = False
    context: list[GuestContextTurn] = Field(default_factory=list, max_length=20)
    message: str = Field(max_length=2000)
    lang: Literal["ru", "kk"]
    response_mode: Literal["text", "voice"] = "text"
    client_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    conversation_id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,100}$")


class HistoryStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS conversations (
                    session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    id TEXT NOT NULL, title TEXT NOT NULL, updated REAL NOT NULL,
                    PRIMARY KEY (session, id)
                );
                CREATE TABLE IF NOT EXISTS turns (
                    session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    client_id TEXT NOT NULL, question TEXT NOT NULL, lang TEXT NOT NULL,
                    reply TEXT NOT NULL, created REAL NOT NULL,
                    PRIMARY KEY (session, client_id)
                );
            """)
            browser_auth.initialize(db)
            columns = {row[1] for row in db.execute("PRAGMA table_info(turns)")}
            if "conversation_id" not in columns:
                db.execute(
                    "ALTER TABLE turns ADD COLUMN conversation_id TEXT NOT NULL DEFAULT 'default'"
                )
            # Keep chats from earlier versions visible in the conversation list.
            db.execute("""INSERT OR IGNORE INTO conversations (session, id, title, updated)
                SELECT t.session, t.conversation_id,
                    (SELECT question FROM turns AS first WHERE first.session=t.session
                     AND first.conversation_id=t.conversation_id ORDER BY created LIMIT 1),
                    MAX(t.created) FROM turns AS t GROUP BY t.session, t.conversation_id""")
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

    def conversations(self, key):
        with self.connect() as db:
            rows = db.execute(
                "SELECT id, title, updated FROM conversations WHERE session=? "
                "ORDER BY updated DESC",
                (key,),
            ).fetchall()
        return [
            {"id": cid, "title": title[:100], "updated_at": updated} for cid, title, updated in rows
        ]

    def require_conversation(self, key, conversation_id):
        with self.connect() as db:
            if not db.execute(
                "SELECT 1 FROM conversations WHERE session=? AND id=?", (key, conversation_id)
            ).fetchone():
                raise HTTPException(404, "conversation_not_found")

    def create_conversation(self, key):
        cid, now = secrets.token_urlsafe(18), time.time()
        with self.connect() as db:
            db.execute("INSERT INTO conversations VALUES (?, ?, '', ?)", (key, cid, now))
        return {"id": cid, "title": "", "updated_at": now}

    def history(self, key, conversation_id="default"):
        with self.connect() as db:
            rows = db.execute(
                "SELECT client_id, question, reply FROM turns "
                "WHERE session=? AND conversation_id=? ORDER BY created",
                (key, conversation_id),
            ).fetchall()
        return [
            {"id": cid, "question": question, **json.loads(reply)} for cid, question, reply in rows
        ]

    def previous(self, key, client_id):
        with self.connect() as db:
            return db.execute(
                "SELECT question, lang, reply, conversation_id FROM turns "
                "WHERE session=? AND client_id=?",
                (key, client_id),
            ).fetchone()

    def save(self, key, body, reply):
        cid, now = body.conversation_id or "default", time.time()
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO conversations VALUES (?, ?, '', ?)", (key, cid, now))
            db.execute(
                "UPDATE conversations SET title=CASE WHEN title='' THEN ? ELSE title END, "
                "updated=? WHERE session=? AND id=?",
                (body.message[:100], now, key, cid),
            )
            db.execute(
                "INSERT INTO turns "
                "(session, client_id, question, lang, reply, created, conversation_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    key,
                    body.client_id,
                    body.message,
                    body.lang,
                    json.dumps(reply, ensure_ascii=False),
                    now,
                    cid,
                ),
            )
            db.execute(
                """DELETE FROM turns WHERE session=? AND conversation_id=? AND client_id NOT IN (
                SELECT client_id FROM turns WHERE session=? AND conversation_id=?
                ORDER BY created DESC LIMIT 100
            )""",
                (key, cid, key, cid),
            )

    def clear(self, key, delete_session=False):
        with self.connect() as db:
            if delete_session:
                db.execute("DELETE FROM sessions WHERE id=?", (key,))
            else:
                db.execute(
                    "DELETE FROM turns WHERE session=? AND conversation_id='default'", (key,)
                )
                db.execute("DELETE FROM conversations WHERE session=? AND id='default'", (key,))


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

    async def guest_session(request: Request, response: Response):
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

    async def current_account(request):
        return await asyncio.to_thread(
            browser_auth.account, request.app.state.history,
            request.cookies.get(browser_auth.AUTH_COOKIE),
        )

    async def session(request: Request, response: Response):
        user = await current_account(request)
        expected = request.headers.get("x-adal-account")
        if expected and (not user or user["id"] != expected):
            raise HTTPException(401, "account_session_changed")
        if user:
            response.headers["Cache-Control"] = "no-store"
            return user["id"]
        return await guest_session(request, response)

    @router.post("/auth/google")
    async def google_login(body: GoogleLogin, request: Request, response: Response):
        client_id = request.app.state.settings.google_oauth_client_id
        if not client_id:
            raise HTTPException(503, "google_login_not_configured")
        key = await guest_session(request, response)
        try:
            claims = await asyncio.to_thread(
                browser_auth.verify_credential, body.credential, client_id
            )
            token = await asyncio.to_thread(
                browser_auth.login, request.app.state.history, key, claims,
                request.cookies.get(browser_auth.AUTH_COOKIE),
            )
        except ValueError:
            raise HTTPException(401, "invalid_google_login") from None
        response.set_cookie(
            browser_auth.AUTH_COOKIE, token, httponly=True, samesite="strict",
            secure=request.url.scheme == "https", max_age=browser_auth.AUTH_TTL, path="/api",
        )
        return {"ok": True}

    @router.post("/auth/logout")
    async def google_logout(request: Request, response: Response):
        user = await current_account(request)
        if user and user["id"] in request.app.state.busy_sessions:
            return error("CONVERSATION_BUSY", 409)
        await asyncio.to_thread(
            browser_auth.logout, request.app.state.history,
            request.cookies.get(browser_auth.AUTH_COOKIE),
        )
        response.delete_cookie(browser_auth.AUTH_COOKIE, path="/api")
        response.headers["Cache-Control"] = "no-store"
        return {"ok": True}

    @router.get("/config")
    async def config(request: Request, response: Response):
        # Establish one cookie before the browser starts independent background requests.
        key = await guest_session(request, response)
        user = await current_account(request)
        nonce = None
        if request.app.state.settings.google_oauth_client_id and not user:
            nonce = await asyncio.to_thread(browser_auth.challenge, request.app.state.history, key)
        return {
            "ai_mode": "real",
            "user": user,
            "google_client_id": request.app.state.settings.google_oauth_client_id or None,
            "google_nonce": nonce,
            "guest_local": True,
            "max_message_chars": 2000,
            "chat_mode": request.app.state.settings.web_chat_mode,
        }

    @router.get("/history")
    async def history(request: Request, response: Response, conversation_id: str | None = None):
        key = await session(request, response)
        store = request.app.state.history
        if conversation_id:
            await asyncio.to_thread(store.require_conversation, key, conversation_id)
        return {"turns": await asyncio.to_thread(store.history, key, conversation_id or "default")}

    @router.get("/search-suggestions/{client_id}")
    async def search_suggestions(client_id: str, request: Request, response: Response):
        key = await session(request, response)
        previous = await asyncio.to_thread(request.app.state.history.previous, key, client_id)
        html = json.loads(previous[2]).get("search_suggestions_html") if previous else None
        if not isinstance(html, str) or not html:
            raise HTTPException(404, "suggestions_not_found")
        return HTMLResponse(
            "<!doctype html><meta charset='utf-8'>" + html,
            headers={
                "Cache-Control": "private, no-store",
                "Content-Security-Policy": "default-src 'none'; script-src 'none'; "
                "style-src 'unsafe-inline'; img-src https://www.gstatic.com "
                "https://www.google.com data:; base-uri 'none'; form-action 'none'; "
                "frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
            },
        )

    @router.get("/conversations")
    async def conversations(request: Request, response: Response):
        key = await session(request, response)
        return {
            "conversations": await asyncio.to_thread(request.app.state.history.conversations, key)
        }

    @router.post("/conversations")
    async def create_conversation(request: Request, response: Response):
        key = await session(request, response)
        if key in request.app.state.busy_sessions:
            return error("CONVERSATION_BUSY", 409)
        return await asyncio.to_thread(request.app.state.history.create_conversation, key)

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
            if body.conversation_id and not body.local_only:
                await asyncio.to_thread(
                    state.history.require_conversation, key, body.conversation_id
                )
            previous = None if body.local_only else await asyncio.to_thread(
                state.history.previous, key, body.client_id
            )
            if previous:
                if previous[:2] != (body.message, body.lang) or previous[3] != (
                    body.conversation_id or "default"
                ):
                    return error("AI_BAD_RESPONSE", 409)
                return json.loads(previous[2])
            history = ([turn.model_dump() for turn in body.context] if body.local_only
                       else await asyncio.to_thread(
                           state.history.history, key, body.conversation_id or "default"
                       ))
            answer_lang = reply_language(body.message, body.lang, history)
            if state.settings.web_chat_mode == "deepseek":
                if (
                    not state.settings.deepseek_api_key or not state.settings.deepseek_model
                ) and not (state.settings.web_search_enabled and state.settings.gemini_api_key):
                    return error("AI_NOT_CONFIGURED")
                if state.slots.locked():
                    return error("RATE_LIMITED", 429)
                try:
                    async with state.slots, asyncio.timeout(state.settings.request_timeout_seconds):
                        reply = await direct_answer(
                            state.settings,
                            state.http,
                            body.message,
                            answer_lang,
                            history,
                            body.response_mode,
                        )
                except TimeoutError:
                    return error("AI_TIMEOUT")
                except InvalidModelOutput:
                    return error("AI_BAD_RESPONSE")
                except ProviderUnavailable:
                    return error("AI_FAILED")
                reply["response_language"] = answer_lang
                if reply.get("search_suggestions_html") and not body.local_only:
                    reply["search_suggestions_url"] = f"/api/search-suggestions/{body.client_id}"
                if not body.local_only:
                    await asyncio.to_thread(state.history.save, key, body, reply)
                return reply
            try:
                result = await run_ask(
                    AskRequest(
                        question=body.message,
                        language=answer_lang,
                        response_mode=body.response_mode,
                    ),
                    request,
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
                "response_language": answer_lang,
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
            if not body.local_only:
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
                response.delete_cookie(browser_auth.AUTH_COOKIE, path="/api")
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
