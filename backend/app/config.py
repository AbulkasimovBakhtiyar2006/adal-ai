from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]
Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = ""
    generator_provider: Literal["gemini", "deepseek"] = "gemini"
    deepseek_api_key: SecretStr = SecretStr("")
    deepseek_model: str = "deepseek-flash"
    audio_model: str = ""
    admin_api_key: SecretStr = SecretStr("")
    runtime_dir: Path = ROOT / "data/runtime"
    library_dir: Path = ROOT / "data/library"
    critic_api_key: SecretStr = SecretStr("")
    critic_model: str = ""
    critic_base_url: str = "https://api.deepseek.com"
    google_cloud_project: str = ""
    corpus_path: Path = ROOT / "data/knowledge.jsonl"
    source_max_age_days: int = Field(default=30, ge=1, le=365)
    allowed_source_hosts: list[str] = [
        "adilet.zan.kz",
        "adilet.gov.kz",
        "old.adilet.zan.kz",
        "www.akorda.kz",
        "akorda.kz",
        "www.gov.kz",
        "gov.kz",
        "egov.kz",
        "www.egov.kz",
    ]
    grounding_support_threshold: Score = 0.95
    grounding_claim_threshold: Score = 0.95
    grounding_citation_threshold: Score = 0.8
    backend_api_key: SecretStr = SecretStr("")
    public_web_enabled: bool = False
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    provider_timeout_seconds: float = Field(default=25, gt=0, le=120)
    request_timeout_seconds: float = Field(default=100, gt=0, le=300)
    max_concurrent_requests: int = Field(default=4, ge=1, le=32)
    retrieval_top_k: int = Field(default=5, ge=1, le=8)
    context_max_characters: int = Field(default=30000, ge=9500, le=60000)

    @field_validator("corpus_path", "runtime_dir", "library_dir")
    @classmethod
    def resolve_corpus(cls, path: Path) -> Path:
        return path if path.is_absolute() else ROOT / path

    @field_validator("gemini_model", "audio_model", "google_cloud_project")
    @classmethod
    def path_component(cls, value: str) -> str:
        if value and not all(c.isascii() and (c.isalnum() or c in "-_.") for c in value):
            raise ValueError("Invalid provider resource name")
        return value

    @field_validator("critic_base_url")
    @classmethod
    def secure_endpoint(cls, value: str) -> str:
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError("Critic URL must be HTTPS without credentials, query or fragment")
        return value.rstrip("/")

    @model_validator(mode="after")
    def public_bind_requires_key(self) -> "Settings":
        if self.public_web_enabled and not self.admin_api_key:
            raise ValueError("Set ADMIN_API_KEY before enabling the public website")
        if self.host not in {"127.0.0.1", "localhost", "::1"} and not self.backend_api_key:
            raise ValueError("Set BACKEND_API_KEY before binding to a public interface")
        return self

    def missing_configuration(self) -> list[str]:
        names = ["google_cloud_project", "critic_model"]
        names += (
            ["gemini_api_key", "gemini_model"]
            if self.generator_provider == "gemini"
            else ["deepseek_api_key", "deepseek_model"]
        )
        missing = [name.upper() for name in names if not getattr(self, name)]
        if not self.effective_critic_key():
            missing.append("CRITIC_API_KEY")
        return missing

    def effective_critic_key(self) -> str:
        if self.critic_api_key:
            return self.critic_api_key.get_secret_value()
        if self.critic_base_url == "https://api.deepseek.com":
            return self.deepseek_api_key.get_secret_value()
        return ""
