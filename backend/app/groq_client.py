"""Minimal client for Groq's OpenAI-compatible chat completions API."""

from __future__ import annotations

import httpx


class TutorServiceError(Exception):
    """An error that should be shown to the user with the given HTTP status."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class GroqClient:
    def __init__(self, api_key: str, model: str, base_url: str, timeout: float = 30.0):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def complete(self, messages: list[dict[str, str]]) -> str:
        payload = {"model": self.model, "messages": messages, "temperature": 0.3, "max_tokens": 900}
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise TutorServiceError(504, "The AI service took too long to respond. Please try again.") from exc
        except httpx.HTTPError as exc:
            raise TutorServiceError(502, "Could not reach the AI service (Groq). Check the server's internet access.") from exc

        if response.status_code == 401:
            raise TutorServiceError(502, "The AI service rejected the API key. Check GROQ_API_KEY on the server.")
        if response.status_code == 429:
            raise TutorServiceError(429, "The AI service's rate limit or free-tier quota was reached. Wait a minute and try again.")
        if response.status_code == 404:
            raise TutorServiceError(502, f"The AI model '{self.model}' was not found. Check GROQ_MODEL on the server.")
        if response.status_code >= 400:
            raise TutorServiceError(502, f"The AI service returned an error (HTTP {response.status_code}).")

        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise TutorServiceError(502, "The AI service returned an unexpected response.") from exc
        if not isinstance(content, str) or not content.strip():
            raise TutorServiceError(502, "The AI service returned an empty answer.")
        return content.strip()
