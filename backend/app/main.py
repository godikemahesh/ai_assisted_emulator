"""FastAPI application: a small, stateless proxy between the browser and the Groq API.

Why a backend at all? The Groq API key must stay secret. If it were in the browser's
JavaScript, anyone could copy it. The browser calls /api/tutor here; this server adds the
key (from an environment variable) and forwards the request to Groq.

The backend has no access to the emulator: it receives a copy of the state as JSON and
returns text. It exposes no endpoint that could run or modify a program.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Optional, Protocol

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .groq_client import GroqClient, TutorServiceError
from .prompts import build_messages
from .schemas import HealthResponse, TutorRequest, TutorResponse


class ChatClient(Protocol):
    async def complete(self, messages: list[dict[str, str]]) -> str: ...


class RateLimiter:
    """Allows `limit` requests per client per 60 seconds (in memory, per server process)."""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit = limit
        self.window = window
        self.hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        if self.limit <= 0:
            return True
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def create_app(settings: Optional[Settings] = None, ai_client: Optional[ChatClient] = None) -> FastAPI:
    settings = settings or get_settings()
    if ai_client is None and settings.ai_configured:
        ai_client = GroqClient(
            settings.groq_api_key, settings.groq_model, settings.groq_base_url, settings.request_timeout_seconds
        )

    app = FastAPI(
        title="AI-Assisted 8086 Emulator - Tutor API",
        version="1.0.0",
        description="Optional AI tutor backend. The emulator itself runs entirely in the browser.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    limiter = RateLimiter(settings.rate_limit_per_minute)

    @app.get("/")
    def root() -> dict:
        return {"service": "8086 emulator AI tutor API", "health": "/api/health", "docs": "/docs"}

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            ai_configured=ai_client is not None,
            provider="groq",
            model=settings.groq_model if ai_client is not None else None,
        )

    @app.post("/api/tutor", response_model=TutorResponse)
    async def tutor(body: TutorRequest, request: Request) -> TutorResponse:
        if ai_client is None:
            raise HTTPException(
                status_code=503,
                detail="The AI tutor is not configured on the server (GROQ_API_KEY is missing). "
                "The emulator works normally without it.",
            )
        if not limiter.allow(client_ip(request)):
            raise HTTPException(status_code=429, detail="Too many tutor requests. Please wait a minute and try again.")
        try:
            answer = await ai_client.complete(build_messages(body))
        except TutorServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
        return TutorResponse(answer=answer, model=settings.groq_model)

    return app


app = create_app()
