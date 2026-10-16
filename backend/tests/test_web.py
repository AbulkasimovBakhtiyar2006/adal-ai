import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.main import create_app
from tests.conftest import FakeProviders
from tests.test_api import write_sources


def test_public_website_keeps_admin_and_direct_api_private(settings, sources, draft):
    write_sources(settings, sources)
    settings.public_web_enabled = True
    settings.admin_api_key = SecretStr("admin-test")
    settings.backend_api_key = SecretStr("backend-test")
    with TestClient(
        create_app(settings, FakeProviders(draft)), base_url="https://adal.example"
    ) as client:
        assert client.get("/api/config").status_code == 200
        response = client.get("/api/history")
        assert response.status_code == 200
        assert "Secure" in response.headers["set-cookie"]
        body = {"message": "Как рассматривается заявление?", "lang": "ru", "client_id": "public-1"}
        assert client.post("/api/chat", json=body).status_code == 200
        assert client.get("/ready").status_code == 401
        assert client.post("/api/ask", json={"question": body["message"]}).status_code == 401
        assert client.get("/admin/api/status", headers={"X-Adal-Admin": "1"}).status_code == 401
        assert (
            client.delete("/api/session", headers={"Origin": "https://evil.example"}).status_code
            == 403
        )


def test_private_website_still_requires_backend_key(settings, draft):
    settings.backend_api_key = SecretStr("backend-test")
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.get("/api/config").status_code == 401
        assert (
            client.get("/api/config", headers={"Authorization": "Bearer backend-test"}).status_code
            == 200
        )


def test_public_website_requires_admin_key():
    with pytest.raises(ValidationError, match="ADMIN_API_KEY"):
        Settings(_env_file=None, public_web_enabled=True)


def test_browser_chat_history_and_idempotency(settings, sources, draft):
    write_sources(settings, sources)
    providers = FakeProviders(draft)
    app = create_app(settings, providers)
    with TestClient(app) as client:
        assert client.get("/api/config").json()["ai_mode"] == "real"
        initial = client.get("/api/history")
        assert initial.json() == {"turns": []}
        assert "HttpOnly" in initial.headers["set-cookie"]
        assert "SameSite=strict" in initial.headers["set-cookie"]
        body = {
            "message": "Как рассматривается заявление?",
            "lang": "ru",
            "client_id": "question-1",
        }
        reply = client.post("/api/chat", json=body)
        assert reply.status_code == 200
        assert reply.json()["status"] == "answered"
        assert reply.json()["sources"][0]["url"] == sources[0].url
        assert reply.headers["cache-control"] == "no-store"
        assert client.post("/api/chat", json=body).json() == reply.json()
        assert providers.calls == ["generate", "ground", "critic"]
        assert client.post("/api/chat", json=body | {"message": "Другой вопрос"}).status_code == 409
        turns = client.get("/api/history").json()["turns"]
        assert len(turns) == 1 and turns[0]["question"] == body["message"]
        cookies = client.cookies
    # History survives process restart, but belongs only to this browser session.
    with TestClient(create_app(settings, providers)) as client:
        assert client.get("/api/history").json()["turns"] == []
        client.cookies.clear()
        client.cookies.update(cookies)
        assert len(client.get("/api/history").json()["turns"]) == 1
        assert client.delete("/api/history").status_code == 204
        assert client.get("/api/history").json()["turns"] == []
        assert client.post("/api/chat", json=body).status_code == 200
        assert client.delete("/api/session").status_code == 204
        assert "adal_session" not in client.cookies
        assert client.get("/api/history").json()["turns"] == []


def test_unconfigured_ai_returns_real_error_not_mock(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        client.get("/api/history")
        response = client.post(
            "/api/chat",
            json={"message": "Сұрақ туралы ақпарат", "lang": "kk", "client_id": "kk-test"},
        )
        assert response.status_code == 503
        assert response.json() == {"error": {"code": "AI_NOT_CONFIGURED"}}
        assert client.get("/api/history").json()["turns"] == []


def test_chat_forwards_kazakh_and_normalizes_abstention(settings, sources, draft):
    from app.models import Draft

    write_sources(settings, sources)

    class KazakhProviders(FakeProviders):
        async def generate(self, question, language, sources, feedback):
            assert language == "kk"
            return Draft(language="kk", insufficient_evidence=True, claims=[])

    with TestClient(create_app(settings, KazakhProviders(draft))) as client:
        client.get("/api/history")
        response = client.post(
            "/api/chat",
            json={"message": "Өтініш қалай қаралады?", "lang": "kk", "client_id": "kk-test"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "insufficient_information"
        assert response.json()["ai_mode"] == "real"


def test_browser_cross_origin_rejected(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert (
            client.delete("/api/session", headers={"Origin": "https://evil.example"}).status_code
            == 403
        )


def test_built_frontend_does_not_swallow_api_errors(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.get("/api/unknown").status_code == 404
        assert client.get("/admin").status_code == 200


def test_separate_conversations_survive_restart_and_are_private(settings, sources, draft):
    write_sources(settings, sources)
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.get("/api/conversations").json() == {"conversations": []}
        first = client.post("/api/conversations").json()["id"]
        second = client.post("/api/conversations").json()["id"]
        body = {
            "message": "Как рассматривается заявление?",
            "lang": "ru",
            "client_id": "one",
            "conversation_id": first,
        }
        assert client.post("/api/chat", json=body).status_code == 200
        assert (
            len(client.get("/api/history", params={"conversation_id": first}).json()["turns"]) == 1
        )
        assert client.get("/api/history", params={"conversation_id": second}).json()["turns"] == []
        assert client.post("/api/chat", json=body | {"conversation_id": second}).status_code == 409
        listing = client.get("/api/conversations").json()["conversations"]
        assert listing[0]["id"] == first and listing[0]["title"] == body["message"]
        cookies = client.cookies
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        client.get("/api/conversations")
        assert client.get("/api/history", params={"conversation_id": first}).status_code == 404
        assert client.post("/api/chat", json=body).status_code == 404
        client.cookies.clear()
        client.cookies.update(cookies)
        assert len(client.get("/api/conversations").json()["conversations"]) == 2
        assert (
            len(client.get("/api/history", params={"conversation_id": first}).json()["turns"]) == 1
        )
        assert client.delete("/api/session").status_code == 204
        assert client.get("/api/conversations").json()["conversations"] == []
        with client.app.state.history.connect() as db:
            assert db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM turns").fetchone()[0] == 0


def test_existing_history_is_migrated_to_conversation(tmp_path):
    import json
    import sqlite3
    import time

    from app.web import HistoryStore

    path = tmp_path / "legacy.sqlite"
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE sessions (id TEXT PRIMARY KEY, expires REAL NOT NULL);
            CREATE TABLE turns (session TEXT, client_id TEXT, question TEXT,
                                lang TEXT, reply TEXT, created REAL,
                                PRIMARY KEY (session, client_id));
        """)
        db.execute("INSERT INTO sessions VALUES (?, ?)", ("browser", time.time() + 100))
        db.execute(
            "INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)",
            ("browser", "one", "Старый вопрос", "ru", json.dumps({"answer": "Ответ"}), time.time()),
        )
    store = HistoryStore(path)
    assert store.conversations("browser")[0]["title"] == "Старый вопрос"
    assert store.history("browser", "default")[0]["answer"] == "Ответ"
    assert len(HistoryStore(path).conversations("browser")) == 1
