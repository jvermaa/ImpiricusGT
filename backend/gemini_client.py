"""Gemini calls with a hard timeout. Any failure returns None so callers can fall back."""

import os
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

_TIMEOUT_SECONDS = 12


def generate_text(prompt: str) -> str | None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip() or "gemini-2.0-flash"

    def _call() -> str:
        from google import genai

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(model=model, contents=prompt)
        text = getattr(response, "text", None)
        if not text or not str(text).strip():
            raise ValueError("Gemini returned an empty response.")
        return str(text)

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(_call).result(timeout=_TIMEOUT_SECONDS)
    except (FuturesTimeout, Exception):
        return None
