import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import speech
from app.main import create_app
from app.providers import ProviderUnavailable
from tests.conftest import FakeProviders


def configure(settings):
    settings.elevenlabs_api_key = SecretStr("private-eleven-key")
    settings.elevenlabs_voice_id = "shared-voice"
    settings.elevenlabs_voice_id_kk = "kazakh-voice"


async def test_provider_receives_language_and_specific_voice(settings):
    configure(settings)

    def handle(request):
        assert request.url.path == "/v1/text-to-speech/kazakh-voice"
        assert request.headers["xi-api-key"] == "private-eleven-key"
        assert json.loads(request.content) == {
            "text": "Сәлем!", "language_code": "kk", "model_id": "eleven_v3",
        }
        return httpx.Response(200, content=b"ID3-test", headers={"Content-Type": "audio/mpeg"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        assert await speech.synthesize(
            speech.SpeechRequest(text="Сәлем!", lang="kk"), settings, client
        ) == b"ID3-test"


@pytest.mark.parametrize("status,content,kind", [
    (401, b"private provider error", "application/json"),
    (200, b"{}", "application/json"),
    (200, b"", "audio/mpeg"),
    (200, b"x" * (5 * 1024 * 1024 + 1), "audio/mpeg"),
])
async def test_provider_failures_are_not_returned_as_audio(settings, status, content, kind):
    configure(settings)
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(status, content=content, headers={"Content-Type": kind})
    )) as client:
        with pytest.raises(ProviderUnavailable):
            await speech.synthesize(speech.SpeechRequest(text="Привет", lang="ru"), settings, client)


def test_config_exposes_capability_only_and_speech_preserves_session(settings, draft, monkeypatch):
    configure(settings)

    async def synthesize(body, effective, client):
        assert body.lang == "kk"
        return b"ID3-test"

    monkeypatch.setattr(speech, "synthesize", synthesize)
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        config = client.get("/api/config")
        assert config.json()["speech_languages"] == ["ru", "kk"]
        assert "private-eleven-key" not in config.text
        assert "shared-voice" not in config.text
        client.cookies.clear()
        response = client.post("/api/speech", json={"text": "Сәлем!", "lang": "kk"})
        assert response.status_code == 200
        assert response.content == b"ID3-test"
        assert response.headers["content-type"] == "audio/mpeg"
        assert response.headers["cache-control"] == "no-store"
        assert client.cookies.get("adal_session")


def test_speech_requires_configuration_and_valid_input(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.get("/api/config").json()["speech_languages"] == []
        assert client.post("/api/speech", json={"text": "Hello", "lang": "ru"}).status_code == 503
        for body in ({"text": " ", "lang": "kk"}, {"text": "x" * 1501, "lang": "ru"},
                     {"text": "Hello", "lang": "en"}):
            assert client.post("/api/speech", json=body).status_code == 422


def test_speech_keeps_browser_access_checks(settings, draft):
    configure(settings)
    settings.backend_api_key = SecretStr("backend-secret")
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        body = {"text": "Сәлем!", "lang": "kk"}
        assert client.post("/api/speech", json=body).status_code == 401
        assert client.post("/api/speech", json=body, headers={
            "Authorization": "Bearer backend-secret", "Origin": "https://evil.example",
        }).status_code == 403
        assert client.post("/api/speech", json=body, headers={
            "Authorization": "Bearer backend-secret", "X-Adal-Account": "expired-account",
        }).status_code == 401


def test_speech_failure_and_capacity_return_safe_errors(settings, draft, monkeypatch):
    configure(settings)

    async def fail(*args):
        raise ProviderUnavailable("provider private details")

    monkeypatch.setattr(speech, "synthesize", fail)
    app = create_app(settings, FakeProviders(draft))
    with TestClient(app) as client:
        body = {"text": "Сәлем!", "lang": "kk"}
        response = client.post("/api/speech", json=body)
        assert response.status_code == 503
        assert response.json() == {"error": {"code": "AI_FAILED"}}
        monkeypatch.setattr(app.state.speech_limits, "admit", lambda: False)
        assert client.post("/api/speech", json=body).status_code == 429


def test_rate_limit_expires(monkeypatch):
    monkeypatch.setattr(speech.time, "monotonic", lambda: 100)
    limits = speech.SpeechLimits()
    assert all(limits.admit() for _ in range(30))
    assert not limits.admit()
    monkeypatch.setattr(speech.time, "monotonic", lambda: 161)
    assert limits.admit()
