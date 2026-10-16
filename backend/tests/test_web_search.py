import json

import httpx
import pytest

from app import network_chat
from app.providers import InvalidModelOutput
from app.web_search import download, safe_url, search


@pytest.mark.parametrize(
    "url",
    [
        "http://www.gov.kz/a",
        "https://gov.kz.evil.example/a",
        "https://user:secret@www.gov.kz/a",
        "https://127.0.0.1/a",
        "https://www.gov.kz:8443/a",
        "file:///etc/passwd",
    ],
)
def test_disallow_untrusted_urls(url):
    assert not safe_url(url)


@pytest.mark.asyncio
async def test_search_fetches_pages_and_rejects_nonofficial_results():
    fetched = []

    def handler(req):
        fetched.append(str(req.url))
        if req.url.host == "www.bing.com":
            return httpx.Response(
                200,
                headers={"content-type": "application/rss+xml"},
                text="""
                <rss><channel><item><link>https://www.gov.kz/article/123</link></item>
                <item><link>https://evil.example/</link></item></channel></rss>""",
            )
        assert req.url.host == "www.gov.kz"
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><title>Программа</title><body><article><p>"
            + "Официальное описание программы. " * 15
            + "</p></article></body></html>",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        results = await search(client, "Программа Казахстана")
    assert len(results) == 1
    assert results[0]["title"] == "Программа"
    assert "Официальное описание" in results[0]["text"]
    assert len(fetched) == 2


@pytest.mark.asyncio
async def test_redirect_cannot_fetch_private_host():
    calls = []

    def handler(req):
        calls.append(str(req.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="unapproved_source"):
            await download(client, "https://www.gov.kz/article/1")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_approved_redirect_and_download_limit():
    def handler(req):
        if req.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"x" * 1_000_001)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError, match="source_too_large"):
            await download(client, "https://www.gov.kz/old")


SOURCE = {
    "id": 1,
    "title": "Официальная программа",
    "url": "https://www.gov.kz/article/123",
    "text": "Единая программа воспитания.",
    "retrieved_at": "2026-10-16",
}


@pytest.mark.asyncio
async def test_network_answer_uses_actual_source_and_context(settings, monkeypatch):
    prompts = []

    async def find(client, query):
        assert query == "Адал азамат"
        return [SOURCE]

    async def complete(settings, client, system, data, max_tokens=2300):
        prompts.append((system, data))
        if len(prompts) == 1:
            return {"needs_search": True, "query": "Адал азамат"}
        assert data["sources"] == [SOURCE]
        return {"answer": "Это единая программа воспитания. [1]", "source_ids": [1]}

    monkeypatch.setattr(network_chat, "search", find)
    monkeypatch.setattr(network_chat, "completion", complete)
    history = [{"question": "Расскажи про Адал азамат", "answer": "OLD INCORRECT ANSWER"}]
    reply = await network_chat.answer(settings, None, "А цели?", "ru", history)
    assert reply["verification_mode"] == "web_sources"
    assert "[1](https://www.gov.kz/article/123)" in reply["answer"]
    assert reply["sources"][0]["url"] == SOURCE["url"]
    assert "OLD INCORRECT ANSWER" not in json.dumps(prompts)
    assert "UNTRUSTED DATA" in prompts[1][0]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad",
    [
        {"answer": "Факт [99]", "source_ids": [1]},
        {"answer": "Факт", "source_ids": [99]},
        {"answer": "https://invented.example", "source_ids": [1]},
        {"answer": "Факт", "source_ids": [True]},
    ],
)
async def test_rejects_invented_citations(settings, monkeypatch, bad):
    async def find(*args):
        return [SOURCE]

    async def complete(settings, client, system, data, max_tokens=2300):
        return {"needs_search": True, "query": "Программа"} if max_tokens == 300 else bad

    monkeypatch.setattr(network_chat, "search", find)
    monkeypatch.setattr(network_chat, "completion", complete)
    with pytest.raises(InvalidModelOutput):
        await network_chat.answer(settings, None, "Программа?", "ru", [])


@pytest.mark.asyncio
async def test_search_outage_does_not_invent_answer(settings, monkeypatch):
    async def find(*args):
        return []

    async def complete(*args):
        return {"needs_search": True, "query": "Программа"}

    monkeypatch.setattr(network_chat, "search", find)
    monkeypatch.setattr(network_chat, "completion", complete)
    reply = await network_chat.answer(settings, None, "Программа?", "ru", [])
    assert reply["status"] == "insufficient_information"
    assert reply["sources"] == []
    assert reply["verification_mode"] == "web_unavailable"


@pytest.mark.asyncio
async def test_empty_search_retries_topic_without_generic_words():
    queries = []

    def handler(req):
        if req.url.host == "www.bing.com":
            queries.append(req.url.params["q"])
            item = (
                ""
                if len(queries) == 1
                else "<item><link>https://www.gov.kz/article/123</link></item>"
            )
            return httpx.Response(
                200,
                headers={"content-type": "application/xml"},
                text=f"<rss><channel>{item}</channel></rss>",
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<article><p>" + "Описание международной стипендии. " * 12 + "</p></article>",
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        sources = await search(client, "стипендия Болашак")
    assert queries == ["стипендия Болашак site:gov.kz", "Болашак"]
    assert len(sources) == 1
