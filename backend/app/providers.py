import asyncio
import json
from typing import Protocol

import google.auth
import httpx
from google.auth.transport.requests import Request
from pydantic import ValidationError

from app.config import Settings
from app.models import CriticReport, DocumentChunk, Draft, Language
from app.prompts import CRITIC, GENERATOR
from app.verification import GroundingReport, answer_text


class ProviderUnavailable(Exception):
    """Safe, body-free error for network/authentication/provider failures."""


class InvalidModelOutput(Exception):
    """A model produced malformed or incomplete structured data."""


class Providers(Protocol):
    async def generate(
        self, question: str, language: Language, sources: list[DocumentChunk], feedback: list[str]
    ) -> Draft: ...
    async def ground(self, draft: Draft, sources: list[DocumentChunk]) -> GroundingReport: ...
    async def critique(
        self, question: str, language: Language, draft: Draft, sources: list[DocumentChunk]
    ) -> CriticReport: ...


def source_data(sources: list[DocumentChunk]) -> list[dict]:
    return [source.model_dump(mode="json") for source in sources]


class LiveProviders:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.settings = settings
        self.client = client
        self._credentials = None
        self._auth_lock = asyncio.Lock()

    async def _post(self, url: str, headers: dict, payload: dict) -> dict:
        try:
            response = await self.client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            # Never log response bodies: they may contain user data or credentials.
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Expected JSON object")
            return data
        except (httpx.HTTPError, ValueError) as exc:
            raise ProviderUnavailable("provider_request_failed") from exc

    async def generate(
        self, question: str, language: Language, sources: list[DocumentChunk], feedback: list[str]
    ) -> Draft:
        settings = self.settings
        context = {
            "question": question,
            "language": language,
            "documents": source_data(sources),
            "correction_error_codes": feedback,
        }
        if settings.generator_provider == "deepseek":
            data = await self._post(
                "https://api.deepseek.com/chat/completions",
                {"Authorization": f"Bearer {settings.deepseek_api_key.get_secret_value()}"},
                {
                    "model": settings.deepseek_model,
                    "stream": False,
                    "max_tokens": 4096,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {
                            "role": "system",
                            "content": GENERATOR
                            + "\nJSON schema:\n"
                            + json.dumps(Draft.model_json_schema()),
                        },
                        {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
                    ],
                },
            )
            try:
                choice = data["choices"][0]
                if choice.get("finish_reason") != "stop":
                    raise ValueError("Generation incomplete")
                return Draft.model_validate_json(choice["message"]["content"])
            except (KeyError, IndexError, AttributeError, TypeError, ValueError) as exc:
                raise InvalidModelOutput("invalid_generator_output") from exc
        data = await self._post(
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{settings.gemini_model}:generateContent",
            {"x-goog-api-key": settings.gemini_api_key.get_secret_value()},
            {
                "systemInstruction": {"parts": [{"text": GENERATOR}]},
                "contents": [
                    {"role": "user", "parts": [{"text": json.dumps(context, ensure_ascii=False)}]}
                ],
                "generationConfig": {
                    "temperature": 0,
                    "maxOutputTokens": 4096,
                    "responseFormat": {
                        "text": {
                            "mimeType": "application/json",
                            "schema": Draft.model_json_schema(),
                        }
                    },
                },
            },
        )
        try:
            candidate = data["candidates"][0]
            if candidate.get("finishReason") != "STOP":
                raise ValueError("Generation incomplete or blocked")
            text = "".join(
                part.get("text", "")
                for part in candidate["content"]["parts"]
                if not part.get("thought")
            )
            return Draft.model_validate_json(text)
        except (
            KeyError,
            IndexError,
            AttributeError,
            TypeError,
            ValueError,
            ValidationError,
        ) as exc:
            raise InvalidModelOutput("invalid_generator_output") from exc

    def _refresh_token(self) -> str:
        if self._credentials is None:
            self._credentials, _ = google.auth.default(
                scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
        if not self._credentials.valid:
            # google-auth's transport is synchronous; bound its network calls as well.
            transport = Request()

            def bounded_request(*args, **kwargs):
                kwargs["timeout"] = self.settings.provider_timeout_seconds
                return transport(*args, **kwargs)

            self._credentials.refresh(bounded_request)
        if not self._credentials.token:
            raise ValueError("Missing ADC token")
        return self._credentials.token

    async def ground(self, draft: Draft, sources: list[DocumentChunk]) -> GroundingReport:
        try:
            async with self._auth_lock:
                token = await asyncio.to_thread(self._refresh_token)
        except Exception as exc:
            raise ProviderUnavailable("grounding_authentication_failed") from exc
        settings = self.settings
        data = await self._post(
            "https://discoveryengine.googleapis.com/v1/projects/"
            f"{settings.google_cloud_project}/locations/global/groundingConfigs/"
            "default_grounding_config:check",
            {
                "Authorization": f"Bearer {token}",
                "X-Goog-User-Project": settings.google_cloud_project,
            },
            {
                "answerCandidate": answer_text(draft),
                "facts": [
                    {
                        "factText": source.text,
                        "attributes": {
                            "source_id": source.id,
                            "title": source.title,
                            "url": source.url,
                            "revision": source.revision,
                        },
                    }
                    for source in sources
                ],
                "groundingSpec": {
                    "citationThreshold": settings.grounding_citation_threshold,
                    "enableClaimLevelScore": True,
                },
            },
        )
        try:
            return GroundingReport.model_validate(data)
        except ValidationError as exc:
            raise ProviderUnavailable("invalid_grounding_response") from exc

    async def critique(
        self, question: str, language: Language, draft: Draft, sources: list[DocumentChunk]
    ) -> CriticReport:
        context = {
            "question": question,
            "language": language,
            "answer": draft.model_dump(mode="json"),
            "documents": source_data(sources),
        }
        data = await self._post(
            f"{self.settings.critic_base_url}/chat/completions",
            {"Authorization": f"Bearer {self.settings.effective_critic_key()}"},
            {
                "model": self.settings.critic_model,
                "temperature": 0,
                "max_tokens": 4096,
                "stream": False,
                "response_format": {"type": "json_object"},
                "messages": [
                    {
                        "role": "system",
                        "content": CRITIC
                        + "\nJSON schema:\n"
                        + json.dumps(CriticReport.model_json_schema()),
                    },
                    {"role": "user", "content": json.dumps(context, ensure_ascii=False)},
                ],
            },
        )
        try:
            choice = data["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("Critic response incomplete")
            return CriticReport.model_validate_json(choice["message"]["content"])
        except (
            KeyError,
            IndexError,
            AttributeError,
            TypeError,
            ValueError,
            ValidationError,
        ) as exc:
            raise ProviderUnavailable("invalid_critic_response") from exc
