import time

import pytest
from fastapi.testclient import TestClient

from app import browser_auth
from app.main import create_app
from tests.conftest import FakeProviders
from tests.test_api import write_sources
from tests.test_direct_chat import enable


def google_login(client, monkeypatch, sub="user-1", nonce=None):
    config = client.get("/api/config").json()
    claims = {
        "sub": sub,
        "email": "user@example.com",
        "name": "Test User",
        "email_verified": True,
        "nonce": nonce or config["google_nonce"],
    }
    monkeypatch.setattr(browser_auth, "verify_credential", lambda *_: claims)
    return client.post("/api/auth/google", json={"credential": "test-token"})


def test_account_history_survives_logout_and_another_browser(settings, sources, draft, monkeypatch):
    settings.google_oauth_client_id = "test.apps.googleusercontent.com"
    write_sources(settings, sources)
    app = create_app(settings, FakeProviders(draft))
    with TestClient(app, base_url="https://adal.example") as client:
        assert google_login(client, monkeypatch).status_code == 200
        token = client.cookies.get(browser_auth.AUTH_COOKIE)
        config = client.get("/api/config").json()
        assert config["user"]["name"] == "Test User"
        cid = client.post("/api/conversations").json()["id"]
        body = {
            "message": "Как рассматривается заявление?",
            "lang": "ru",
            "client_id": "account-question",
            "conversation_id": cid,
        }
        assert client.post("/api/chat", json=body).status_code == 200
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/config").json()["user"] is None
        assert client.get("/api/conversations").json()["conversations"] == []
        assert browser_auth.account(app.state.history, token) is None
    with TestClient(create_app(settings, FakeProviders(draft))) as other:
        assert google_login(other, monkeypatch).status_code == 200
        assert other.get("/api/conversations").json()["conversations"][0]["id"] == cid
        assert len(other.get("/api/history", params={"conversation_id": cid}).json()["turns"]) == 1
        assert other.post("/api/auth/logout").status_code == 200
        assert google_login(other, monkeypatch, sub="user-2").status_code == 200
        assert other.get("/api/history", params={"conversation_id": cid}).status_code == 404
        assert (
            other.get(
                "/api/conversations", headers={"X-Adal-Account": config["user"]["id"]}
            ).status_code
            == 401
        )


def test_login_nonce_cookie_security_replay_and_wrong_browser(settings, draft, monkeypatch):
    settings.google_oauth_client_id = "test.apps.googleusercontent.com"
    app = create_app(settings, FakeProviders(draft))
    with TestClient(app, base_url="https://adal.example") as client:
        nonce = client.get("/api/config").json()["google_nonce"]
        assert google_login(client, monkeypatch, nonce="wrong").status_code == 401
        response = google_login(client, monkeypatch, nonce=nonce)
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert all(flag in cookie for flag in ["Secure", "HttpOnly", "SameSite=strict"])
        assert client.post("/api/auth/google", json={"credential": "replay"}).status_code == 401
        assert (
            client.post(
                "/api/auth/google",
                json={"credential": "token"},
                headers={"Origin": "https://evil.example"},
            ).status_code
            == 403
        )
        with app.state.history.connect() as db:
            db.execute("UPDATE account_tokens SET expires=?", (time.time() - 1,))
        assert client.get("/api/config").json()["user"] is None
        unused_nonce = client.get("/api/config").json()["google_nonce"]
        client.cookies.clear()
        assert google_login(client, monkeypatch, nonce=unused_nonce).status_code == 401


def test_google_disabled_and_bad_tokens(settings, draft, monkeypatch):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.get("/api/config").json()["google_client_id"] is None
        assert client.post("/api/auth/google", json={"credential": "x"}).status_code == 503
        settings.google_oauth_client_id = "test.apps.googleusercontent.com"

        def invalid(*_):
            raise ValueError("signature failed")

        monkeypatch.setattr(browser_auth, "verify_credential", invalid)
        assert client.post("/api/auth/google", json={"credential": "x"}).status_code == 401
        assert client.get("/api/config").json()["user"] is None


def test_guest_context_is_used_without_persisting_messages(settings, monkeypatch):
    received = []

    async def answer(settings, http, message, lang, history, mode):
        received.extend(history)
        return {"answer": "Продолжение", "sources": [], "ai_mode": "real"}

    monkeypatch.setattr("app.web.direct_answer", answer)
    app = create_app(enable(settings))
    with TestClient(app) as client:
        assert client.get("/api/config").json()["guest_local"] is True
        body = {
            "message": "Продолжи ответ",
            "lang": "ru",
            "client_id": "guest-question",
            "conversation_id": "browser-only",
            "local_only": True,
            "context": [{"question": "Предыдущий вопрос", "answer": "Предыдущий ответ"}],
        }
        assert client.post("/api/chat", json=body).status_code == 200
        assert received == [body["context"][0] | {"attachments": []}]
        assert client.get("/api/conversations").json()["conversations"] == []
        with app.state.history.connect() as db:
            assert db.execute("SELECT COUNT(*) FROM turns").fetchone()[0] == 0
        assert (
            client.post("/api/chat", json=body | {"context": body["context"] * 21}).status_code
            == 422
        )


def test_delete_account_revokes_all_devices(settings, draft, monkeypatch):
    settings.google_oauth_client_id = "test.apps.googleusercontent.com"
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert google_login(client, monkeypatch).status_code == 200
        token = client.cookies.get(browser_auth.AUTH_COOKIE)
        assert client.delete("/api/session").status_code == 204
        assert browser_auth.account(client.app.state.history, token) is None
        assert client.get("/api/config").json()["user"] is None
        assert google_login(client, monkeypatch).status_code == 200
        assert client.get("/api/conversations").json()["conversations"] == []


def test_verifier_uses_configured_audience_and_rejects_unverified_email(monkeypatch):
    seen = []

    def verify(token, transport, audience):
        seen.append((token, audience))
        return {"sub": "123", "email": "a@example.com", "email_verified": False}

    monkeypatch.setattr(browser_auth.id_token, "verify_oauth2_token", verify)
    with pytest.raises(ValueError):
        browser_auth.verify_credential("jwt", "configured-client")
    assert seen == [("jwt", "configured-client")]
