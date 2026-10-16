import json

import httpx
import pytest

from app.providers import InvalidModelOutput, LiveProviders, ProviderUnavailable
from tests.conftest import critic_for, grounding_for


async def test_generator_request_and_response(settings, sources, draft):
    def handler(request):
        assert request.url.host == "generativelanguage.googleapis.com"
        assert request.headers["x-goog-api-key"] == "test-gemini"
        assert "test-gemini" not in str(request.url)
        payload = json.loads(request.content)
        assert payload["systemInstruction"]["parts"][0]["text"]
        assert (
            payload["generationConfig"]["responseFormat"]["text"]["mimeType"] == "application/json"
        )
        context = json.loads(payload["contents"][0]["parts"][0]["text"])
        assert context["documents"][0]["id"] == sources[0].id
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {"parts": [{"text": draft.model_dump_json()}]},
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await LiveProviders(settings, client).generate("Вопрос", "ru", sources, []) == draft


async def test_critic_is_not_given_google_scores(settings, sources, draft):
    report = critic_for(draft)

    def handler(request):
        assert request.url.path == "/chat/completions"
        payload = json.loads(request.content)
        assert payload["response_format"] == {"type": "json_object"}
        context = json.loads(payload["messages"][1]["content"])
        assert set(context) == {"question", "language", "answer", "documents"}
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": report.model_dump_json(),
                        },
                    }
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await LiveProviders(settings, client).critique("Вопрос", "ru", draft, sources)
        assert result == report


async def test_google_request_uses_adc_and_claim_scores(settings, sources, draft, monkeypatch):
    report = grounding_for(draft, sources)

    def handler(request):
        assert request.headers["Authorization"] == "Bearer test-adc-token"
        assert request.url.host == "discoveryengine.googleapis.com"
        assert request.url.path.endswith("default_grounding_config:check")
        payload = json.loads(request.content)
        assert payload["groundingSpec"]["enableClaimLevelScore"] is True
        assert payload["facts"][0]["factText"] == sources[0].text
        return httpx.Response(200, json=report.model_dump(by_alias=True))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        provider = LiveProviders(settings, client)
        monkeypatch.setattr(provider, "_refresh_token", lambda: "test-adc-token")
        assert await provider.ground(draft, sources) == report


@pytest.mark.parametrize("code", [401, 429, 500])
async def test_remote_error_is_not_returned_to_caller(settings, sources, code):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(code, text="PRIVATE API DETAILS"))
    ) as client:
        with pytest.raises(ProviderUnavailable) as error:
            await LiveProviders(settings, client).generate("Вопрос", "ru", sources, [])
        assert "PRIVATE" not in str(error.value)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"candidates": []},
        {"candidates": [None]},
        {"candidates": [{"finishReason": "STOP", "content": {"parts": [None]}}]},
        {"candidates": [{"finishReason": "MAX_TOKENS"}]},
        {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "not json"}]}}]},
    ],
)
async def test_invalid_generation_is_not_an_answer(settings, sources, body):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    ) as client:
        with pytest.raises(InvalidModelOutput):
            await LiveProviders(settings, client).generate("Вопрос", "ru", sources, [])


async def test_invalid_critic_fails_closed(settings, sources, draft):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": "{}",
                            },
                        }
                    ]
                },
            )
        )
    ) as client:
        with pytest.raises(ProviderUnavailable):
            await LiveProviders(settings, client).critique("Вопрос", "ru", draft, sources)
