"""Request/response models. Sizes are limited so the API cannot be used to send huge payloads."""

from __future__ import annotations

import json
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

TutorMode = Literal["explain_instruction", "explain_state", "explain_trace", "diagnose_errors", "question"]

MAX_SNAPSHOT_CHARS = 20_000


class TraceEntry(BaseModel):
    step: Optional[int] = None
    address: Optional[str] = Field(None, max_length=20)
    line: Optional[int] = None
    asm: Optional[str] = Field(None, max_length=200)
    bytes: Optional[str] = Field(None, max_length=60)
    description: Optional[str] = Field(None, max_length=500)
    changes: Optional[str] = Field(None, max_length=1000)
    error: Optional[str] = Field(None, max_length=500)


class AsmErrorInfo(BaseModel):
    line: Optional[int] = None
    message: str = Field("", max_length=500)
    hint: Optional[str] = Field(None, max_length=500)
    source: Optional[str] = Field(None, max_length=300)


class TutorRequest(BaseModel):
    mode: TutorMode
    question: str = Field("", max_length=2000)
    program: str = Field("", max_length=20_000)
    selected_line: Optional[int] = Field(None, ge=1, le=100_000)
    selected_text: str = Field("", max_length=300)
    snapshot: dict[str, Any] = Field(default_factory=dict)
    trace: list[TraceEntry] = Field(default_factory=list, max_length=40)
    errors: list[AsmErrorInfo] = Field(default_factory=list, max_length=50)
    supported_instructions: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("snapshot")
    @classmethod
    def snapshot_not_too_large(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value, default=str)) > MAX_SNAPSHOT_CHARS:
            raise ValueError("snapshot is too large")
        return value

    @field_validator("question")
    @classmethod
    def question_required_for_question_mode(cls, value: str, info) -> str:
        if info.data.get("mode") == "question" and not value.strip():
            raise ValueError("a question is required in 'question' mode")
        return value


class TutorResponse(BaseModel):
    answer: str
    model: str
    disclaimer: str = (
        "AI explanation only. The emulator, not the AI, determines execution results."
    )


class HealthResponse(BaseModel):
    status: str
    ai_configured: bool
    provider: str
    model: Optional[str]
