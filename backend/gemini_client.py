import json
import os
import urllib.error
import urllib.request


def _generate_text_for_model(prompt: str, *, key: str, model: str) -> str | None:
    if not key or not prompt.strip() or not model:
        return None
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={key}"
    )
    body = json.dumps(
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.4},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read().decode("utf-8"))
        parts = payload["candidates"][0]["content"]["parts"]
        text = "".join(part.get("text", "") for part in parts).strip()
        return text or None
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        print(
            f"[gemini_client] model={model} http_status={error.code} "
            f"error={error_body[:800]}",
            flush=True,
        )
        return None
    except (KeyError, IndexError, OSError, json.JSONDecodeError, ValueError) as error:
        print(f"[gemini_client] model={model} error={type(error).__name__}: {error}", flush=True)
        return None


def generate_text(prompt: str) -> str | None:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    primary_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip() or "gemini-3.8-flash"
    fallback_model = os.getenv("GEMINI_FALLBACK_MODEL", "").strip()
    if not key or not prompt.strip():
        return None

    models = [primary_model]
    if fallback_model and fallback_model != primary_model:
        models.append(fallback_model)

    for model in models:
        text = _generate_text_for_model(prompt, key=key, model=model)
        if text:
            return text
    return None
