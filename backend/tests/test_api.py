import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.main import create_app
from tests.conftest import FakeProviders


def write_sources(settings, sources):
    settings.corpus_path.write_text(
        "\n".join(s.model_dump_json() for s in sources), encoding="utf-8"
    )


def test_api_contract(settings, sources, draft):
    write_sources(settings, sources)
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.get("/health").json() == {"status": "ok"}
        ready = client.get("/ready")
        assert ready.status_code == 200
        assert ready.json()["external_connectivity"] == "not_tested"
        response = client.post("/api/ask", json={"question": "Как рассматривается заявление?"})
        assert response.status_code == 200
        assert response.json()["status"] == "answered"
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["request_id"] == response.headers["x-request-id"]


def test_empty_configuration_is_honest(settings, draft):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code == 503
        response = client.post("/api/ask", json={"question": "Как подать заявление?"})
        assert response.status_code == 503
        assert response.json()["status"] == "temporarily_unavailable"
        assert response.json()["claims"] == []


def test_key_and_validation_do_not_echo_input(settings, sources, draft):
    write_sources(settings, sources)
    settings.backend_api_key = SecretStr("test-api-key")
    fake = FakeProviders(draft)
    with TestClient(create_app(settings, fake)) as client:
        assert client.post("/api/ask", json={"question": "Заявление"}).status_code == 401
        assert client.get("/ready").status_code == 401
        headers = {"Authorization": "Bearer test-api-key"}
        response = client.post("/api/ask", headers=headers, json={"question": "PRIVATE" * 1000})
        assert response.status_code == 422
        assert "PRIVATE" not in response.text
        response = client.post(
            "/api/ask", headers=headers, json={"question": "Заявление", "language": "en"}
        )
        assert response.status_code == 422
        assert fake.calls == []


@pytest.mark.parametrize("question", ["   ", "", "12", 123, None])
def test_invalid_questions(settings, draft, question):
    with TestClient(create_app(settings, FakeProviders(draft))) as client:
        assert client.post("/api/ask", json={"question": question}).status_code == 422


async def test_concurrency_limit(settings, sources, draft):
    write_sources(settings, sources)
    entered = asyncio.Event()
    release = asyncio.Event()

    class SlowProviders(FakeProviders):
        async def generate(self, *args):
            entered.set()
            await release.wait()
            return self.draft

    settings.max_concurrent_requests = 1
    app = create_app(settings, SlowProviders(draft))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            first = asyncio.create_task(client.post("/api/ask", json={"question": "Заявление"}))
            await asyncio.wait_for(entered.wait(), timeout=1)
            second = await client.post("/api/ask", json={"question": "Заявление"})
            assert second.status_code == 429
            release.set()
            assert (await first).status_code == 200
