"""Settings, read from environment variables (or a local backend/.env file)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load backend/.env for local development. On Render, variables come from the dashboard.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DEFAULT_MODEL = "llama-3.3-70b-versatile"
DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    groq_api_key: str = ""
    groq_model: str = DEFAULT_MODEL
    groq_base_url: str = "https://api.groq.com/openai/v1"
    allowed_origins: list[str] = field(default_factory=lambda: DEFAULT_ORIGINS.split(","))
    rate_limit_per_minute: int = 20
    request_timeout_seconds: float = 30.0

    @property
    def ai_configured(self) -> bool:
        return bool(self.groq_api_key.strip())


def get_settings() -> Settings:
    origins = os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS)
    return Settings(
        groq_api_key=os.getenv("GROQ_API_KEY", "").strip(),
        groq_model=os.getenv("GROQ_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        groq_base_url=os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/"),
        allowed_origins=[o.strip().rstrip("/") for o in origins.split(",") if o.strip()],
        rate_limit_per_minute=_int("RATE_LIMIT_PER_MINUTE", 20),
    )
