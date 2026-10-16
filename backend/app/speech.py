"""Server-only ElevenLabs credentials and bounded, non-streaming speech generation."""

import asyncio
import time
from collections import deque
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings
from app.providers import ProviderUnavailable


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=1500)
    lang: Literal["ru", "kk"]


def voice_id(settings: Settings, lang: str) -> str:
    return getattr(settings, f"elevenlabs_voice_id_{lang}") or settings.elevenlabs_voice_id


def languages(settings: Settings) -> list[str]:
    return [lang for lang in ("ru", "kk") if settings.elevenlabs_api_key and voice_id(settings, lang)]


class SpeechLimits:
    """Bound paid synthesis across the process, including anonymous sessions."""

    def __init__(self):
        self.slots = asyncio.Semaphore(2)
        self.requests: deque[float] = deque()

    def admit(self) -> bool:
        now = time.monotonic()
        while self.requests and self.requests[0] <= now - 60:
            self.requests.popleft()
        if self.slots.locked() or len(self.requests) >= 30:
            return False
        self.requests.append(now)
        return True


async def synthesize(body: SpeechRequest, settings: Settings, client: httpx.AsyncClient) -> bytes:
    if body.lang not in languages(settings):
        raise ProviderUnavailable("speech_not_configured")
    try:
        async with asyncio.timeout(20), client.stream(
            "POST",
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id(settings, body.lang)}",
            headers={"xi-api-key": settings.elevenlabs_api_key.get_secret_value()},
            params={"output_format": "mp3_44100_128"},
            json={"text": body.text, "model_id": settings.elevenlabs_model,
                  "language_code": body.lang},
            timeout=20,
        ) as response:
            response.raise_for_status()
            if not response.headers.get("content-type", "").startswith("audio/"):
                raise ValueError("invalid_speech_type")
            audio = bytearray()
            async for chunk in response.aiter_bytes():
                audio.extend(chunk)
                if len(audio) > 5 * 1024 * 1024:
                    raise ValueError("speech_too_large")
            if not audio:
                raise ValueError("empty_speech")
            return bytes(audio)
    except (httpx.HTTPError, TimeoutError, ValueError) as exc:
        raise ProviderUnavailable("speech_failed") from exc
