"""Atomic local storage. Secret settings never enter API responses."""

import json
import os
import tempfile
from pathlib import Path

from pydantic import SecretStr

from app.config import Settings

EDITABLE = {
    "generator_provider",
    "deepseek_api_key",
    "deepseek_model",
    "gemini_api_key",
    "gemini_model",
    "critic_api_key",
    "critic_model",
    "google_cloud_project",
    "audio_model",
    "grounding_support_threshold",
    "grounding_claim_threshold",
    "grounding_citation_threshold",
}
SECRET_FIELDS = {"deepseek_api_key", "gemini_api_key", "critic_api_key"}


def atomic_write(path: Path, content: bytes, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if private:
        path.parent.chmod(0o700)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temp, 0o600 if private else 0o644)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def read_settings(base: Settings) -> Settings:
    path = base.runtime_dir / "settings.json"
    if not path.exists():
        return base
    overrides = json.loads(path.read_text())
    if not isinstance(overrides, dict) or set(overrides) - EDITABLE:
        raise ValueError("Invalid saved settings")
    return Settings(_env_file=None, **(base.model_dump() | overrides))


def save_settings(current: Settings, values: dict) -> Settings:
    if set(values) - EDITABLE:
        raise ValueError("Unknown settings")
    candidate = Settings(_env_file=None, **(current.model_dump() | values))
    saved = {}
    for key in EDITABLE:
        value = getattr(candidate, key)
        saved[key] = value.get_secret_value() if isinstance(value, SecretStr) else value
    atomic_write(
        current.runtime_dir / "settings.json",
        json.dumps(saved, ensure_ascii=False).encode(),
        private=True,
    )
    return candidate


def public_settings(settings: Settings) -> dict:
    public = {key: getattr(settings, key) for key in EDITABLE - SECRET_FIELDS}
    public["configured_keys"] = {key: bool(getattr(settings, key)) for key in SECRET_FIELDS}
    public["critic_base_url"] = settings.critic_base_url
    public["missing_configuration"] = settings.missing_configuration()
    public["audio_configured"] = bool(
        settings.gemini_api_key and (settings.audio_model or settings.gemini_model)
    )
    public["same_model_for_generation_and_critic"] = (
        settings.generator_provider == "deepseek"
        and settings.critic_base_url == "https://api.deepseek.com"
        and settings.deepseek_model == settings.critic_model
    )
    return public
