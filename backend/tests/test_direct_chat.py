import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.main import create_app


def enable(settings):
    settings.web_chat_mode = "deepseek"
    settings.deepseek_api_key = SecretStr("test-deepseek")
    settings.google_cloud_project = ""
    settings.critic_api_key = SecretStr("")
    settings.gemini_api_key = SecretStr("")
    return settings


def test_direct_chat_without_google_or_documents_and_private_history(settings, monkeypatch):
    calls = []

    async def post(self, url, **kwargs):
        assert url == "https://api.deepseek.com/chat/completions"
        assert kwargs["headers"]["Authorization"] == "Bearer test-deepseek"
        calls.append(kwargs["json"])
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "choices": [
                    {"finish_reason": "stop", "message": {"content": "Сәлем! Қалай көмектесейін?"}}
                ]
            },
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    app = create_app(enable(settings))
    with TestClient(app) as client:
        client.get("/api/history")
        body = {"message": "Сәлем, көмектесші", "lang": "kk", "client_id": "direct-1"}
        r = client.post("/api/chat", json=body)
        assert r.status_code == 200
        assert r.json()["verification_mode"] == "model_only"
        assert r.json()["sources"] == []
        assert "тексерілмеген" in r.json()["answer"]
        assert "Kazakh" in calls[0]["messages"][0]["content"]
        assert client.post("/api/chat", json=body).json() == r.json()
        assert len(calls) == 1
        assert (
            client.post(
                "/api/chat", json=body | {"client_id": "direct-2", "message": "Жалғастыр"}
            ).status_code
            == 200
        )
        assert calls[1]["messages"][1]["content"] == body["message"]
        # A new conversation never receives another conversation's context.
        cid = client.post("/api/conversations").json()["id"]
        assert (
            client.post(
                "/api/chat", json=body | {"client_id": "direct-3", "conversation_id": cid}
            ).status_code
            == 200
        )
        assert len(calls[2]["messages"]) == 2
        assert client.delete("/api/session").status_code == 204
        assert client.get("/api/history").json()["turns"] == []


@pytest.mark.parametrize(
    ("failure", "code"),
    [("http", "AI_FAILED"), ("timeout", "AI_TIMEOUT"), ("truncated", "AI_BAD_RESPONSE")],
)
def test_direct_failures_are_not_saved_or_leaked(settings, monkeypatch, failure, code):
    async def post(self, url, **kwargs):
        req = httpx.Request("POST", url)
        if failure == "timeout":
            raise httpx.ReadTimeout("secret-provider-body", request=req)
        if failure == "http":
            return httpx.Response(402, request=req, json={"error": "secret-provider-body"})
        return httpx.Response(
            200,
            request=req,
            json={"choices": [{"finish_reason": "length", "message": {"content": "incomplete"}}]},
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    with TestClient(create_app(enable(settings))) as client:
        client.get("/api/history")
        r = client.post(
            "/api/chat", json={"message": "Помоги с вопросом", "lang": "ru", "client_id": "failure"}
        )
        assert r.status_code == 503
        assert r.json() == {"error": {"code": code}}
        assert client.get("/api/history").json()["turns"] == []


def test_direct_missing_key_and_concurrency_limit(settings, monkeypatch):
    app = create_app(enable(settings))
    with TestClient(app) as client:
        body = {"message": "Привет", "lang": "ru", "client_id": "limited"}
        settings.deepseek_api_key = SecretStr("")
        assert client.post("/api/chat", json=body).json()["error"]["code"] == "AI_NOT_CONFIGURED"
        settings.deepseek_api_key = SecretStr("test-deepseek")
        monkeypatch.setattr(app.state.slots, "locked", lambda: True)
        assert client.post("/api/chat", json=body).status_code == 429
