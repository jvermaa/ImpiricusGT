import json
from collections.abc import Iterable

from gemini_client import generate_text


def _extract_json_payload(raw: str) -> dict | None:
    text = raw.strip()
    if not text:
        return None
    if "```" in text:
        text = text.replace("```json", "```").replace("```JSON", "```")
        fenced = [part.strip() for part in text.split("```") if part.strip()]
        for block in fenced:
            if block.startswith("{") and block.endswith("}"):
                text = block
                break
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(text[start : end + 1])
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _tokenize(parts: Iterable[str]) -> set[str]:
    tokens: set[str] = set()
    for part in parts:
        for token in part.lower().replace(",", " ").replace(";", " ").split():
            cleaned = token.strip()
            if len(cleaned) >= 3:
                tokens.add(cleaned)
    return tokens


def _deterministic_score(query: dict, candidate: dict) -> float:
    query_dx = str(query.get("diagnosis_label") or "").strip().lower()
    candidate_dx = str(candidate.get("diagnosis_label") or "").strip().lower()
    query_age_group = str(query.get("age_group") or "")
    candidate_age_group = str(candidate.get("age_group") or "")
    query_symptoms = [str(item).strip() for item in query.get("symptom_labels", []) if str(item).strip()]
    candidate_symptoms = [
        str(item).strip() for item in candidate.get("symptom_labels", []) if str(item).strip()
    ]

    query_symptom_tokens = _tokenize(query_symptoms)
    candidate_symptom_tokens = _tokenize(candidate_symptoms)
    symptom_overlap = len(query_symptom_tokens & candidate_symptom_tokens)
    symptom_base = max(1, len(query_symptom_tokens))
    symptom_score = min(1.0, symptom_overlap / symptom_base)

    diagnosis_score = 1.0 if query_dx and query_dx == candidate_dx else 0.0
    age_score = 1.0 if query_age_group and query_age_group == candidate_age_group else 0.0

    return 0.5 * symptom_score + 0.35 * diagnosis_score + 0.15 * age_score


def _clamp_confidence(value, fallback: int) -> int:
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return fallback
    return max(0, min(100, numeric))


def _fallback_matches(query: dict, candidates: list[dict], limit: int) -> list[dict]:
    ranked = sorted(
        candidates,
        key=lambda item: (
            -_deterministic_score(query, item),
            str(item.get("diagnosis_label", "")).lower(),
            str(item.get("age_group", "")),
        ),
    )
    output: list[dict] = []
    for item in ranked[:limit]:
        score = _deterministic_score(query, item)
        output.append(
            {
                "match_id": item["match_id"],
                "confidence_percent": max(40, min(99, int(round(score * 100)))),
                "rationale": "Fallback ranking from diagnosis overlap, symptom overlap, and age cohort.",
            }
        )
    return output


def _build_prompt(query: dict, candidates: list[dict], limit: int) -> str:
    payload = {
        "query_patient": query,
        "candidates": [
            {
                "match_id": row["match_id"],
                "age_group": row.get("age_group"),
                "diagnosis_label": row.get("diagnosis_label"),
                "symptom_labels": row.get("symptom_labels", []),
                "sex_label": row.get("sex_label"),
            }
            for row in candidates
        ],
        "limit": limit,
    }
    return (
        "You are ranking de-identified peer cohorts for a clinician. "
        "Use only the supplied JSON. "
        "Return strict JSON with this schema: "
        '{"summary":"string","matches":[{"match_id":"string","confidence_percent":0-100,"rationale":"string"}]}. '
        "Do not add markdown or extra keys. "
        "Confidence percent should represent clinical similarity strength. "
        f"Input JSON: {json.dumps(payload, separators=(',', ':'))}"
    )


def rank_cohort_matches(
    query: dict,
    candidates: list[dict],
    limit: int = 10,
) -> tuple[str, str | None, list[dict]]:
    if not candidates:
        return ("fallback", None, [])
    prompt = _build_prompt(query, candidates, limit)
    model_text = generate_text(prompt)
    if not model_text:
        return ("fallback", None, _fallback_matches(query, candidates, limit))

    payload = _extract_json_payload(model_text)
    if not payload:
        return ("fallback", None, _fallback_matches(query, candidates, limit))

    summary = payload.get("summary")
    summary_text = str(summary).strip() if isinstance(summary, str) else None
    rows = payload.get("matches")
    if not isinstance(rows, list):
        return ("fallback", summary_text, _fallback_matches(query, candidates, limit))

    known_ids = {row["match_id"] for row in candidates}
    selected: list[dict] = []
    used_ids: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        match_id = str(row.get("match_id") or "").strip()
        if not match_id or match_id in used_ids or match_id not in known_ids:
            continue
        used_ids.add(match_id)
        selected.append(
            {
                "match_id": match_id,
                "confidence_percent": _clamp_confidence(row.get("confidence_percent"), fallback=70),
                "rationale": str(row.get("rationale") or "").strip()
                or "Gemini-ranked based on cohort-level similarity.",
            }
        )
        if len(selected) >= limit:
            break

    if len(selected) < limit:
        fallback_rows = _fallback_matches(query, candidates, limit)
        for row in fallback_rows:
            if row["match_id"] in used_ids:
                continue
            selected.append(row)
            used_ids.add(row["match_id"])
            if len(selected) >= limit:
                break

    return ("gemini", summary_text, selected)
