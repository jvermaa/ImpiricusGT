"""Optional Anthropic-backed JSON extraction.

The API key is optional: without it, callers receive ``None`` and use their
deterministic local fallbacks. Prompts and responses are never logged.
"""
import json
import logging
import re
from functools import lru_cache

from . import config

log = logging.getLogger("pcx.llm")


def available() -> bool:
    """Return whether an API key is configured (not whether the service is reachable)."""
    return bool(config.ANTHROPIC_API_KEY) and not config.OFFLINE


@lru_cache(maxsize=1)
def _client():
    if not available():
        return None
    import anthropic

    return anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)


def _parse_json(text: str) -> dict | None:
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", candidate, re.I | re.S)
    if fenced:
        candidate = fenced.group(1)
    try:
        result = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        if start < 0:
            return None
        try:
            result, _ = json.JSONDecoder().raw_decode(candidate[start:])
        except json.JSONDecodeError:
            return None
    return result if isinstance(result, dict) else None


def complete_json(system: str, prompt: str, max_tokens: int = 900) -> dict | None:
    """Ask the configured model for a JSON object; fail closed to local fallbacks."""
    try:
        client = _client()
        if client is None:
            return None
        response = client.messages.create(
            model=config.LLM_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "\n".join(block.text for block in response.content if getattr(block, "text", None))
        return _parse_json(text)
    except Exception as exc:  # network, auth, model, or parsing/service errors
        log.warning("Optional LLM request failed (%s); using local fallback.", type(exc).__name__)
        return None
