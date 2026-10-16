import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import google_search, network_chat
from app.main import create_app
from app.providers import ProviderUnavailable


@pytest.mark.asyncio
async def test_search_retries_model_fetches_actual_pages_and_preserves_widget(settings):
    calls = []

    def handler(req):
        calls.append(str(req.url))
        if req.url.host == "generativelanguage.googleapis.com":
            assert req.headers["x-goog-api-key"] == "test-gemini"
            if "gemini-2.5-flash:" in req.url.path:
                return httpx.Response(429, json={"error": "private error"})
            assert "gemini-3.5-flash-lite:" in req.url.path
            assert json.loads(req.content)["generationConfig"]["thinkingConfig"] == {
                "thinkingLevel": "minimal"
            }
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {"parts": [{"text": "UNVERIFIED SUMMARY"}]},
                            "groundingMetadata": {
                                "groundingChunks": [
                                    {
                                        "web": {
                                            "uri": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/a"
                                        }
                                    },
                                    {"web": {"uri": "https://www.gov.kz/article/2"}},
                                    {"web": {"uri": "https://evil.example/"}},
                                ],
                                "searchEntryPoint": {"renderedContent": "<div>Google Search</div>"},
                            },
                        }
                    ]
                },
            )
        if req.url.host == "vertexaisearch.cloud.google.com":
            return httpx.Response(302, headers={"location": "https://www.gov.kz/article/1"})
        assert req.url.host == "www.gov.kz"
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<article><p>" + "Retrieved official page. " * 20 + "</p></article>",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        sources, widget = await google_search.search(settings, client, "Образование")
    assert len(sources) == 2
    assert "Google Search" in widget
    assert all("Retrieved official page" in s["text"] for s in sources)
    assert "UNVERIFIED SUMMARY" not in json.dumps(sources)
    assert not any("evil.example" in url for url in calls)


@pytest.mark.asyncio
async def test_google_redirect_does_not_fetch_arbitrary_destination():
    calls = []

    def handler(req):
        calls.append(str(req.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/private"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert (
            await google_search.official_url(
                client, "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test"
            )
            is None
        )
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_both_models_unavailable_preserves_cited_excerpts(settings, monkeypatch):
    async def unavailable(*args, **kwargs):
        raise ProviderUnavailable("private error")

    async def found(*args):
        return [
            {
                "id": 1,
                "title": "Official",
                "url": "https://www.gov.kz/a",
                "text": "Official excerpt [99] https://evil.example",
                "retrieved_at": "2026-10-16",
            }
        ]

    monkeypatch.setattr(network_chat, "completion", unavailable)
    monkeypatch.setattr(google_search, "completion", unavailable)
    monkeypatch.setattr(network_chat, "search", found)
    reply = await network_chat.answer(settings, None, "Болашак", "ru", [])
    assert reply["verification_mode"] == "source_excerpts"
    assert reply["status"] == "insufficient_information"
    assert "[1](https://www.gov.kz/a)" in reply["answer"]
    assert "[99]" not in reply["answer"] and "evil.example" not in reply["answer"]
    assert "private error" not in str(reply)


@pytest.mark.asyncio
async def test_deepseek_outage_uses_gemini_with_same_source_validation(settings, monkeypatch):
    async def unavailable(*args, **kwargs):
        raise ProviderUnavailable("unavailable")

    async def discover(*args):
        return (
            [
                {
                    "id": 1,
                    "title": "Official",
                    "url": "https://www.gov.kz/a",
                    "text": "Единая программа воспитания.",
                }
            ],
            "<div>Google</div>",
        )

    async def backup(settings, client, system, data):
        assert data["sources"][0]["text"] == "Единая программа воспитания."
        return {"answer": "Единая программа воспитания. [1]", "source_ids": [1]}

    settings.web_search_enabled = True
    monkeypatch.setattr(network_chat, "completion", unavailable)
    monkeypatch.setattr(google_search, "search", discover)
    monkeypatch.setattr(google_search, "completion", backup)
    reply = await network_chat.answer(settings, None, "Адал азамат", "ru", [])
    assert reply["verification_mode"] == "web_sources"
    assert reply["search_suggestions_html"] == "<div>Google</div>"
    assert reply["sources"][0]["url"] == "https://www.gov.kz/a"


def test_search_widget_is_private_and_scripts_disabled(settings, monkeypatch):
    from app import web

    async def answer(*args):
        return {
            "answer": "Answer",
            "sources": [],
            "status": "answered",
            "ai_mode": "real",
            "search_suggestions_html": "<style>body{color:blue}</style><div>Google Search</div>",
        }

    settings.web_chat_mode = "deepseek"
    settings.deepseek_api_key = SecretStr("test")
    monkeypatch.setattr(web, "direct_answer", answer)
    with TestClient(create_app(settings)) as client:
        client.get("/api/history")
        r = client.post(
            "/api/chat", json={"message": "Адал азамат", "lang": "ru", "client_id": "test"}
        )
        url = r.json()["search_suggestions_url"]
        page = client.get(url)
        assert page.status_code == 200
        assert "Google Search" in page.text
        assert "script-src 'none'" in page.headers["content-security-policy"]
        assert "sandbox allow-popups" in page.headers["content-security-policy"]
        assert "no-store" in page.headers["cache-control"]
        client.cookies.clear()
        assert client.get(url).status_code == 404


@pytest.mark.asyncio
async def test_search_quota_failure_still_loads_official_fallback_pages(settings):
    def handler(req):
        if req.url.host == "generativelanguage.googleapis.com":
            return httpx.Response(429)
        assert req.url.host == "primeminister.kz"
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<article><p>"
            + "Официальное описание экологической программы. " * 10
            + "</p></article>",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        sources, widget = await google_search.search(settings, client, "Таза Қазақстан")
    assert len(sources) == 2
    assert widget == ""
