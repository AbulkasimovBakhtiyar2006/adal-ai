import hashlib
import json

import httpx
import pytest

from app.collector import bounded_get, download_source
from app.library import Library
from app.providers import InvalidModelOutput, LiveProviders

ITEM = {
    "id": "test-law-ru",
    "ngr": "ZTEST",
    "kind": "adilet",
    "language": "ru",
    "title": "Тестовый документ",
    "url": "https://adilet.zan.kz/rus/docs/ZTEST",
}


async def test_collector_preserves_snapshot_and_deduplicates(settings):
    doc = {
        "language": "rus",
        "group_number": "ZTEST",
        "is_actual": True,
        "text_content": "<p>" + "Это вымышленный текст только для тестирования. " * 20 + "</p>",
    }
    library = Library(settings)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"document": doc}))
    ) as client:
        first = await download_source(ITEM, client, library)
        doc["unrelated_page_counter"] = 123
        second = await download_source(ITEM, client, library)
    assert first["id"] == second["id"]
    assert len(library.list()) == 1
    assert first["status"] == "pending" and first["verified_at"] is None
    original = (library.directory(first["id"]) / "original.bin").read_bytes()
    assert hashlib.sha256(original).hexdigest() == first["sha256"]
    assert json.loads(original)["document"]["text_content"] == doc["text_content"]
    assert len(library.text(first["id"])) > 300


async def test_collector_rejects_wrong_language(settings):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"language": "kaz", "group_number": "ZTEST"})
        )
    ) as client:
        with pytest.raises(ValueError, match="identity"):
            await download_source(ITEM, client, Library(settings))


async def test_collector_does_not_follow_redirect_or_fetch_arbitrary_host():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(302, headers={"Location": "http://127.0.0.1/private"})
        )
    ) as client:
        with pytest.raises((ValueError, httpx.HTTPStatusError)):
            await bounded_get(client, "https://adilet.zan.kz/test")
        with pytest.raises(ValueError, match="host"):
            await bounded_get(client, "https://evil.example/test")


async def test_deepseek_generation_contract(settings, sources, draft):
    settings.generator_provider = "deepseek"
    from pydantic import SecretStr

    settings.deepseek_api_key = SecretStr("deepseek-test")

    def handler(request):
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer deepseek-test"
        body = json.loads(request.content)
        assert body["stream"] is False
        assert body["response_format"] == {"type": "json_object"}
        assert json.loads(body["messages"][1]["content"])["documents"][0]["id"] == sources[0].id
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"finish_reason": "stop", "message": {"content": draft.model_dump_json()}}
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await LiveProviders(settings, client).generate("Вопрос", "ru", sources, [])
    assert result == draft


async def test_deepseek_incomplete_generation_rejected(settings, sources):
    settings.generator_provider = "deepseek"
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"choices": [{"finish_reason": "length"}]})
        )
    ) as client:
        with pytest.raises(InvalidModelOutput):
            await LiveProviders(settings, client).generate("Вопрос", "ru", sources, [])
