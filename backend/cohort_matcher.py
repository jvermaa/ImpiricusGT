import json
import re
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


def _normalize_term(value: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", value.lower()).strip()


def _extract_age_focus(parts: Iterable[str]) -> tuple[int | None, int | None]:
    for part in parts:
        lowered = str(part).lower().replace("–", "-").replace("—", "-")
        match = re.search(r"(\d{1,3})\s*-\s*(\d{1,3})", lowered)
        if not match:
            continue
        try:
            low = int(match.group(1))
            high = int(match.group(2))
        except (TypeError, ValueError):
            continue
        if 0 <= low <= 120 and 0 <= high <= 120:
            return (min(low, high), max(low, high))
    return (None, None)


def _split_terms(value: str) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[,/;]", value):
        cleaned = _normalize_term(part)
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        terms.append(cleaned)
    return terms


def _extract_symptom_focus(parts: Iterable[str]) -> tuple[list[str], str, int]:
    terms: list[str] = []
    mode = "all"
    min_match = 1
    for part in parts:
        text = str(part).strip()
        match = re.search(r"symptom relevance focus\s*\((all|any)\)\s*:\s*(.+)$", text, re.I)
        if match:
            mode = match.group(1).lower()
            remainder = match.group(2).strip()
            if "|" in remainder:
                symptom_part, trailing = remainder.split("|", 1)
                remainder = symptom_part.strip()
                minimum = re.search(r"minimum matches\s*:\s*(\d+)", trailing, re.I)
                if minimum:
                    try:
                        min_match = max(1, int(minimum.group(1)))
                    except (TypeError, ValueError):
                        min_match = 1
            terms = _split_terms(remainder)
            if terms:
                return (terms, mode, min_match)
        if text.lower().startswith("key symptoms:"):
            _, _, symptom_text = text.partition(":")
            parsed = _split_terms(symptom_text)
            if parsed and not terms:
                terms = parsed
    return (terms, mode, min_match)


def _relevance_focus(context: dict) -> dict:
    parts = _context_parts(context)
    age_min, age_max = _extract_age_focus(parts)
    symptom_terms, symptom_mode, symptom_min_match = _extract_symptom_focus(parts)
    return {
        "age_min": age_min,
        "age_max": age_max,
        "symptom_terms": symptom_terms,
        "symptom_mode": symptom_mode,
        "symptom_min_match": symptom_min_match,
    }


def _generate_text_with_retry(prompt: str, max_attempts: int = 2) -> tuple[str | None, int]:
    attempts = max(1, max_attempts)
    for attempt in range(1, attempts + 1):
        response = generate_text(prompt)
        if response:
            return (response, attempt)
    return (None, attempts)


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
    model_text, _ = _generate_text_with_retry(prompt)
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


def _context_parts(context: dict) -> list[str]:
    details = context.get("details")
    detail_rows = [str(row).strip() for row in details] if isinstance(details, list) else []
    return [
        str(context.get("kind") or "").strip(),
        str(context.get("title") or "").strip(),
        str(context.get("summary") or "").strip(),
        *detail_rows,
    ]


def _relevance_score(context: dict, candidate: dict) -> float:
    context_tokens = _tokenize(_context_parts(context))
    if not context_tokens:
        return 0.0

    focus = _relevance_focus(context)
    age_min = focus["age_min"]
    age_max = focus["age_max"]
    required_symptoms: list[str] = focus["symptom_terms"]
    symptom_mode: str = focus["symptom_mode"]
    symptom_min_match: int = int(focus["symptom_min_match"])

    candidate_age_raw = candidate.get("age")
    candidate_age = candidate_age_raw if isinstance(candidate_age_raw, int) else None
    age_score = 0.5
    if age_min is not None and age_max is not None:
        if candidate_age is None:
            age_score = 0.3
        elif age_min <= candidate_age <= age_max:
            age_score = 1.0
        else:
            distance = min(abs(candidate_age - age_min), abs(candidate_age - age_max))
            age_score = max(0.0, 1.0 - (distance / 25.0))

    candidate_symptom_terms = {_normalize_term(str(item)) for item in candidate.get("symptom_labels", [])}
    candidate_symptom_terms = {term for term in candidate_symptom_terms if term}
    symptom_score = 0.0
    if required_symptoms:
        matched = sum(1 for term in required_symptoms if term in candidate_symptom_terms)
        if symptom_mode == "any":
            symptom_score = min(1.0, matched / max(1, symptom_min_match))
        else:
            symptom_score = matched / max(1, len(required_symptoms))
    elif candidate_symptom_terms:
        symptom_score = len(context_tokens & _tokenize(candidate_symptom_terms)) / max(1, len(candidate_symptom_terms))

    diagnosis_tokens = _tokenize(
        [
            str(candidate.get("diagnosis_label") or ""),
            str(candidate.get("relevant_medical_history") or ""),
        ]
    )
    diagnosis_score = 0.0
    if diagnosis_tokens:
        diagnosis_score = len(context_tokens & diagnosis_tokens) / max(1, len(diagnosis_tokens))

    candidate_tokens = _tokenize(
        [
            str(candidate.get("diagnosis_label") or ""),
            str(candidate.get("current_medications") or ""),
            str(candidate.get("relevant_medical_history") or ""),
            str(candidate.get("family_medical_history") or ""),
            str(candidate.get("lab_results") or ""),
            " ".join(str(row) for row in candidate.get("symptom_labels", [])),
            " ".join(str(row) for row in candidate.get("recent_visit_summaries", [])),
        ]
    )
    if not candidate_tokens:
        return 0.0

    overlap = len(context_tokens & candidate_tokens)
    base_overlap = min(1.0, overlap / max(1, len(context_tokens)))

    if required_symptoms:
        score = (0.35 * symptom_score) + (0.35 * diagnosis_score) + (0.2 * age_score) + (0.1 * base_overlap)
    else:
        score = (0.45 * diagnosis_score) + (0.25 * age_score) + (0.3 * base_overlap)
    return max(0.0, min(1.0, score))


def _fallback_relevant_patients(context: dict, candidates: list[dict], limit: int) -> list[dict]:
    focus = _relevance_focus(context)
    has_focus = bool(focus["symptom_terms"]) or (
        focus["age_min"] is not None and focus["age_max"] is not None
    )
    min_score = 0.28 if has_focus else 0.15

    ranked = sorted(
        candidates,
        key=lambda item: (
            -_relevance_score(context, item),
            str(item.get("diagnosis_label", "")).lower(),
            str(item.get("patient_key", "")),
        ),
    )
    rows: list[dict] = []
    for item in ranked:
        score = _relevance_score(context, item)
        if score < min_score:
            continue
        confidence = int(round(score * 100))
        rows.append(
            {
                "patient_key": item["patient_key"],
                "confidence_percent": max(5, min(96, confidence)),
                "rationale": "Fallback ranking from age-fit, diagnosis overlap, symptom overlap, and history context.",
            }
        )
        if len(rows) >= limit:
            break
    return rows


def _build_relevant_patients_prompt(context: dict, candidates: list[dict], limit: int) -> str:
    focus = _relevance_focus(context)
    payload = {
        "context": {
            "kind": str(context.get("kind") or "").strip(),
            "title": str(context.get("title") or "").strip(),
            "summary": str(context.get("summary") or "").strip(),
            "details": [str(row).strip() for row in context.get("details", []) if str(row).strip()],
            "focus": focus,
        },
        "patients": [
            {
                "patient_key": row["patient_key"],
                "age": row.get("age"),
                "sex_label": row.get("sex_label"),
                "diagnosis_label": row.get("diagnosis_label"),
                "symptom_labels": row.get("symptom_labels", []),
                "current_medications": row.get("current_medications"),
                "relevant_medical_history": row.get("relevant_medical_history"),
                "family_medical_history": row.get("family_medical_history"),
                "lab_results": row.get("lab_results"),
                "recent_visit_summaries": row.get("recent_visit_summaries", []),
            }
            for row in candidates
        ],
        "limit": limit,
    }
    return (
        "You are ranking which patients are most relevant to a clinical context. "
        "Use only the supplied JSON. "
        "Carefully weigh age compatibility, diagnosis relevance, and symptom overlap. "
        "If the context includes an age focus, strongly penalize large age mismatches unless there is unusually strong diagnosis/symptom evidence. "
        "Penalize candidates whose diagnosis appears poorly aligned to the context. "
        "Return up to the requested limit, but include only clinically relevant patients; returning an empty matches list is allowed. "
        "Return strict JSON with this schema: "
        '{"summary":"string","matches":[{"patient_key":"string","confidence_percent":0-100,"rationale":"string"}]}. '
        "Do not add markdown or extra keys. "
        "Confidence percent should reflect clinical relevance strength. "
        f"Input JSON: {json.dumps(payload, separators=(',', ':'))}"
    )


def _debug_print_relevance_prompt_and_response(
    context: dict, prompt: str, response: str | None, attempts: int
) -> None:
    kind = str(context.get("kind") or "unknown")
    title = str(context.get("title") or "").strip() or "untitled"
    print("\n=== GEMINI RELEVANCE DEBUG START ===", flush=True)
    print(f"Context kind: {kind}", flush=True)
    print(f"Context title: {title}", flush=True)
    print(f"Gemini attempts: {attempts}", flush=True)
    print("--- Prompt ---", flush=True)
    print(prompt, flush=True)
    print("--- Response ---", flush=True)
    print(response if response is not None else "<NO RESPONSE>", flush=True)
    print("=== GEMINI RELEVANCE DEBUG END ===\n", flush=True)


def rank_relevant_patients(
    context: dict,
    candidates: list[dict],
    limit: int = 10,
) -> tuple[str, str | None, list[dict]]:
    if not candidates:
        return ("fallback", None, [])

    prompt = _build_relevant_patients_prompt(context, candidates, limit)
    model_text, attempts = _generate_text_with_retry(prompt)
    _debug_print_relevance_prompt_and_response(context, prompt, model_text, attempts)
    if not model_text:
        return ("fallback", None, _fallback_relevant_patients(context, candidates, limit))

    payload = _extract_json_payload(model_text)
    if not payload:
        return ("fallback", None, _fallback_relevant_patients(context, candidates, limit))

    summary = payload.get("summary")
    summary_text = str(summary).strip() if isinstance(summary, str) else None
    rows = payload.get("matches")
    if not isinstance(rows, list):
        return ("fallback", summary_text, _fallback_relevant_patients(context, candidates, limit))

    known_ids = {row["patient_key"] for row in candidates}
    selected: list[dict] = []
    used_ids: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        patient_key = str(row.get("patient_key") or "").strip()
        if not patient_key or patient_key in used_ids or patient_key not in known_ids:
            continue
        used_ids.add(patient_key)
        selected.append(
            {
                "patient_key": patient_key,
                "confidence_percent": _clamp_confidence(row.get("confidence_percent"), fallback=70),
                "rationale": str(row.get("rationale") or "").strip()
                or "Gemini-ranked based on patient relevance.",
            }
        )
        if len(selected) >= limit:
            break

    if not selected:
        return ("fallback", summary_text, _fallback_relevant_patients(context, candidates, limit))

    return ("gemini", summary_text, selected)
