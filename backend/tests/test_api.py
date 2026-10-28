"""Backend tests. The real Groq API is never called: a fake client stands in for it."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.groq_client import GroqClient, TutorServiceError
from app.main import create_app
from app.prompts import build_messages
from app.schemas import TutorRequest

ORIGIN = "http://localhost:5173"
SNAPSHOT = {"registersHex": {"AX": "0008", "IP": "0006"}, "flags": {"ZF": 0, "CF": 0}, "status": "ready"}


class FakeClient:
    def __init__(self, answer: str = "AX holds 0008h because 5 + 3 = 8.", error: TutorServiceError | None = None):
        self.answer = answer
        self.error = error
        self.calls: list[list[dict[str, str]]] = []

    async def complete(self, messages):
        self.calls.append(messages)
        if self.error:
            raise self.error
        return self.answer


def make_client(ai_client=None, **settings) -> TestClient:
    base = {"groq_api_key": "", "allowed_origins": [ORIGIN], "rate_limit_per_minute": 100}
    base.update(settings)
    return TestClient(create_app(Settings(**base), ai_client=ai_client))


def tutor_body(**overrides):
    body = {
        "mode": "explain_state",
        "program": "MOV AX, 5\nADD AX, 3\nHLT",
        "snapshot": SNAPSHOT,
        "trace": [{"step": 1, "asm": "MOV AX, 0005h", "description": "AX <- 0005h"}],
    }
    body.update(overrides)
    return body


def test_health_without_key_reports_ai_off():
    res = make_client().get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "ai_configured": False, "provider": "groq", "model": None}


def test_health_with_client_reports_model():
    res = make_client(FakeClient(), groq_model="test-model").get("/api/health")
    assert res.json()["ai_configured"] is True
    assert res.json()["model"] == "test-model"


def test_tutor_without_key_returns_clear_503_not_a_fake_answer():
    res = make_client().post("/api/tutor", json=tutor_body())
    assert res.status_code == 503
    assert "GROQ_API_KEY" in res.json()["detail"]
    assert "answer" not in res.json()


def test_tutor_returns_the_model_answer():
    fake = FakeClient()
    res = make_client(fake, groq_model="test-model").post("/api/tutor", json=tutor_body())
    assert res.status_code == 200
    data = res.json()
    assert data["answer"] == fake.answer
    assert data["model"] == "test-model"
    assert "emulator" in data["disclaimer"]
    assert len(fake.calls) == 1


def test_prompt_contains_read_only_rules_and_the_snapshot():
    fake = FakeClient()
    make_client(fake).post("/api/tutor", json=tutor_body(selected_line=2, selected_text="ADD AX, 3"))
    system, user = fake.calls[0]
    assert system["role"] == "system"
    assert "ONLY source of truth" in system["content"]
    assert "cannot execute instructions" in system["content"]
    assert '"AX": "0008"' in user["content"]
    assert "SELECTED LINE 2: ADD AX, 3" in user["content"]
    assert "  2: ADD AX, 3" in user["content"]


def test_supported_instruction_list_is_passed_to_the_model():
    messages = build_messages(TutorRequest(mode="explain_instruction", supported_instructions=["MOV", "HLT"]))
    assert "MOV, HLT" in messages[0]["content"]


@pytest.mark.parametrize(
    "error, status",
    [
        (TutorServiceError(429, "quota reached"), 429),
        (TutorServiceError(502, "bad key"), 502),
        (TutorServiceError(504, "timeout"), 504),
    ],
)
def test_ai_failures_become_clear_http_errors(error, status):
    res = make_client(FakeClient(error=error)).post("/api/tutor", json=tutor_body())
    assert res.status_code == status
    assert res.json()["detail"] == error.message


@pytest.mark.parametrize(
    "overrides",
    [
        {"mode": "run_program"},  # unknown mode
        {"question": "x" * 2001},
        {"program": "x" * 20001},
        {"mode": "question", "question": "   "},  # question mode needs a question
        {"snapshot": {"blob": "x" * 25000}},
        {"trace": [{"step": i} for i in range(41)]},
    ],
)
def test_invalid_or_oversized_requests_are_rejected(overrides):
    res = make_client(FakeClient()).post("/api/tutor", json=tutor_body(**overrides))
    assert res.status_code == 422


def test_cors_allows_the_configured_origin_only():
    client = make_client(FakeClient())
    preflight = {"Origin": ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
    ok = client.options("/api/tutor", headers=preflight)
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == ORIGIN
    bad = client.options("/api/tutor", headers={**preflight, "Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_rate_limit():
    client = make_client(FakeClient(), rate_limit_per_minute=2)
    assert client.post("/api/tutor", json=tutor_body()).status_code == 200
    assert client.post("/api/tutor", json=tutor_body()).status_code == 200
    res = client.post("/api/tutor", json=tutor_body())
    assert res.status_code == 429


def test_api_exposes_no_endpoint_that_could_change_emulator_state():
    app = create_app(Settings(groq_api_key=""))
    routes = {
        (route.path, method)
        for route in app.routes
        if hasattr(route, "methods") and not route.path.startswith(("/docs", "/redoc", "/openapi"))
        for method in route.methods
        if method != "HEAD"
    }
    assert routes == {("/", "GET"), ("/api/health", "GET"), ("/api/tutor", "POST")}


# ---------------------------------------------------------------- GroqClient against a mocked HTTP layer


@pytest.fixture
def patch_httpx(monkeypatch):
    def apply(handler):
        transport = httpx.MockTransport(handler)
        original = httpx.AsyncClient

        class PatchedClient(original):
            def __init__(self, *args, **kwargs):
                kwargs["transport"] = transport
                super().__init__(*args, **kwargs)

        monkeypatch.setattr("app.groq_client.httpx.AsyncClient", PatchedClient)
        return GroqClient("test-key", "test-model", "https://groq.test/openai/v1")

    return apply


@pytest.mark.anyio
async def test_groq_client_sends_key_and_parses_answer(patch_httpx):
    seen = {}

    def handler(request: httpx.Request):
        seen["auth"] = request.headers["authorization"]
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"choices": [{"message": {"content": " Hello "}}]})

    client = patch_httpx(handler)
    assert await client.complete([{"role": "user", "content": "hi"}]) == "Hello"
    assert seen["auth"] == "Bearer test-key"
    assert seen["url"] == "https://groq.test/openai/v1/chat/completions"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "status, expected_status, text",
    [(401, 502, "API key"), (429, 429, "rate limit"), (404, 502, "not found"), (500, 502, "HTTP 500")],
)
async def test_groq_client_maps_http_errors(patch_httpx, status, expected_status, text):
    client = patch_httpx(lambda request: httpx.Response(status, json={}))
    with pytest.raises(TutorServiceError) as info:
        await client.complete([])
    assert info.value.status_code == expected_status
    assert text in info.value.message


@pytest.mark.anyio
async def test_groq_client_handles_network_errors(patch_httpx):
    def handler(request):
        raise httpx.ConnectError("offline")

    client = patch_httpx(handler)
    with pytest.raises(TutorServiceError) as info:
        await client.complete([])
    assert info.value.status_code == 502


@pytest.mark.anyio
async def test_groq_client_rejects_empty_answers(patch_httpx):
    client = patch_httpx(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": "  "}}]}))
    with pytest.raises(TutorServiceError):
        await client.complete([])


@pytest.fixture
def anyio_backend():
    return "asyncio"
