"""Referral directory: load the fixture, filter, and rank.

The ONLY place that knows the fixture's file format is `load_directory()`. To switch
to the team's real data, change that function (or map the new format onto
`Provider`) and everything else keeps working.
"""
import json
import re
from functools import lru_cache

from pydantic import BaseModel, ValidationError, field_validator

from .. import config
from ..embeddings import get_embedder
from ..vectorstore import case_document
from .proximity import distance_band, get_proximity
from .taxonomy import PRESCRIBING_ROLES, ROLES, SPECIALTIES


class Address(BaseModel):
    line1: str
    city: str
    state: str
    zip: str


class Practice(BaseModel):
    name: str
    address: Address


class Provider(BaseModel):
    id: str
    hcp_id: str | None = None
    name: str
    credentials: str
    role: str
    specialty: str
    subspecialty: str | None = None
    focus_areas: list[str] = []
    practice: Practice
    distance_miles: float | None = None   # DEMO ONLY: read via ProximityProvider, never directly
    telehealth: bool = False
    accepting_referrals: bool = True
    languages: list[str] = []
    avg_response_hours: float = 24

    @field_validator("role")
    @classmethod
    def _role(cls, v):
        if v not in ROLES:
            raise ValueError(f"unknown role {v!r}; valid: {ROLES}")
        return v

    @field_validator("specialty")
    @classmethod
    def _specialty(cls, v):
        if v not in SPECIALTIES:
            raise ValueError(f"unknown specialty {v!r}; valid: {SPECIALTIES}")
        return v


class DirectoryError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_directory() -> dict[str, dict]:
    """Load and validate the fixture once. Raises DirectoryError with a clear message."""
    path = config.REFERRAL_DIRECTORY_PATH
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as e:
        raise DirectoryError(f"Referral directory not found at {path}. "
                             "Copy referral_directory.json into backend/fixtures/.") from e
    except json.JSONDecodeError as e:
        raise DirectoryError(f"Referral directory {path} is not valid JSON: {e}") from e

    items = raw.get("providers") if isinstance(raw, dict) else raw
    if not isinstance(items, list) or not items:
        raise DirectoryError(f"{path} must contain a non-empty 'providers' list")

    out: dict[str, dict] = {}
    for i, item in enumerate(items):
        try:
            p = Provider(**item).model_dump()
        except ValidationError as e:
            raise DirectoryError(f"Provider #{i} ({item.get('id', '?')}) in {path} is invalid:\n{e}") from e
        if p["id"] in out:
            raise DirectoryError(f"Duplicate provider id {p['id']} in {path}")
        out[p["id"]] = p
    return out


def get_provider(provider_id: str) -> dict | None:
    return load_directory().get(provider_id)


def _provider_text(p: dict) -> str:
    return " | ".join([p["specialty"], p.get("subspecialty") or "", "; ".join(p.get("focus_areas") or [])])


@lru_cache(maxsize=4)
def _provider_vectors(embedder_name: str) -> dict[str, list[float]]:
    """Embed every provider once (per embedder) and cache it."""
    providers = load_directory()
    ids = list(providers)
    vecs = get_embedder().embed([_provider_text(providers[i]) for i in ids])
    return dict(zip(ids, vecs))


def _dot(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))


def public_summary(p: dict) -> dict:
    """What list views show: city/state only, never the street address."""
    return {
        "id": p["id"], "name": p["name"], "credentials": p["credentials"], "role": p["role"],
        "specialty": p["specialty"], "subspecialty": p.get("subspecialty"),
        "focus_areas": p.get("focus_areas") or [],
        "practice": {"name": p["practice"]["name"], "city": p["practice"]["address"]["city"],
                     "state": p["practice"]["address"]["state"]},
        "telehealth": p["telehealth"], "accepting_referrals": p["accepting_referrals"],
        "languages": p.get("languages") or [],
    }


def facets(accepting: bool = True) -> dict:
    spec, roles = {}, {}
    for p in load_directory().values():
        if accepting and not p["accepting_referrals"]:
            continue
        spec[p["specialty"]] = spec.get(p["specialty"], 0) + 1
        roles[p["role"]] = roles.get(p["role"], 0) + 1
    return {
        "specialties": [{"name": s, "count": spec[s]} for s in SPECIALTIES if s in spec],
        "roles": [{"name": r, "count": roles[r]} for r in ROLES if r in roles],
    }


# Words too generic to count as evidence that a focus area matches a case.
_GENERIC = {"patient", "education", "care", "plans", "therapy", "management", "general",
            "disease", "syndrome", "phenomenon", "switching", "work-up", "dressing", "coordination",
            "triage", "infusion", "related", "chronic"}

# A question about a medication brings the clinical pharmacist into the suggestions.
# Checked against the case WITHOUT its "Current medications: ..." list, otherwise every
# patient on any medication would look like a drug question.
DRUG_CUES = re.compile(r"\b(drugs?|side[- ]effects?|adverse|interactions?|induced|"
                       r"biologics?|statins?|after (?:starting|stopping))\b", re.I)
_MED_LIST = re.compile(r"current medications:[^|]*", re.I)


def is_drug_question(case_text: str) -> bool:
    return bool(DRUG_CUES.search(_MED_LIST.sub("", case_text)))


def _matching_focus(p: dict, case_text: str) -> list[str]:
    """Focus areas that literally share a meaningful word with the case."""
    low = case_text.lower()
    hits = []
    for f in p.get("focus_areas") or []:
        words = [w for w in re.findall(r"[a-z]{4,}", f.lower()) if w not in _GENERIC]
        if any(re.search(rf"\b{re.escape(w.rstrip('s'))}", low) or w in low for w in words):
            hits.append(f)
    return hits


def search(*, origin_hcp_id: str | None, specialty: list[str] | None = None,
           role: list[str] | None = None, focus: str | None = None,
           max_distance: float | None = None, include_telehealth: bool = True,
           accepting: bool = True, language: str | None = None,
           structured: dict | None = None, referral_type: str = "referral",
           sort: str = "best", limit: int = 50, requester_specialty: str | None = None) -> dict:
    proximity = get_proximity()
    hints = [h for h in (structured or {}).get("specialty_hints") or [] if h in SPECIALTIES]
    # You refer for a perspective you don't already have: if the case also points at
    # another specialty, the requester's own specialty becomes secondary.
    if requester_specialty in hints and len(hints) > 1:
        hints = [h for h in hints if h != requester_specialty] + [requester_specialty]
    drug_question = bool(structured) and is_drug_question(case_document(structured))
    # "Ask" a medication question -> suggest the clinical pharmacist too. A formal referral
    # hands over the patient's care, so pharmacy is not auto-suggested there (the doctor
    # can still add it as a filter).
    if drug_question and referral_type == "advice" and "Clinical Pharmacy" not in hints:
        hints.append("Clinical Pharmacy")

    suggested = []
    if not specialty and hints:
        specialty = hints          # case-aware pre-filter; the UI shows these as removable chips
        suggested = hints

    case_vec, case_text = None, ""
    if structured:
        case_text = case_document(structured)
        case_vec = get_embedder().embed([case_text])[0]
        vectors = _provider_vectors(get_embedder().name)

    results = []
    for p in load_directory().values():
        if accepting and not p["accepting_referrals"]:
            continue
        if specialty and p["specialty"] not in specialty:
            continue
        if role and p["role"] not in role:
            continue
        if focus and not any(focus.lower() in f.lower() for f in p.get("focus_areas") or []):
            continue
        if language and language.lower() not in [l.lower() for l in p.get("languages") or []]:
            continue

        d = proximity.distance_miles(origin_hcp_id, p)
        if max_distance is not None and (d is None or d > max_distance):
            if not (include_telehealth and p["telehealth"]):
                continue

        # ----- scoring -----
        if hints:
            spec_fit = (max(0.4, 1.0 - 0.2 * hints.index(p["specialty"]))
                        if p["specialty"] in hints else 0.0)
        else:
            spec_fit = 1.0 if (specialty and p["specialty"] in specialty) else 0.0
        prox = 0.0 if d is None else max(0.0, 1 - d / config.PROXIMITY_FULL_SCORE_MILES)
        if referral_type == "advice" or p["telehealth"]:
            prox = max(prox, config.REMOTE_PROXIMITY_FLOOR)
        resp = 1 - min(p["avg_response_hours"], 48) / 48
        if p["role"] in PRESCRIBING_ROLES:
            role_fit = 1.0
        elif referral_type == "referral":
            role_fit = config.ROLE_FIT_NON_PRESCRIBER_REFERRAL
        elif p["role"] == "pharmacist" and drug_question:
            role_fit = 1.0
        else:
            role_fit = config.ROLE_FIT_ADVICE_OTHER
        focus_hits = _matching_focus(p, case_text) if case_text else []

        if case_vec is not None:
            emb = max(0.0, min(1.0, _dot(case_vec, vectors[p["id"]])))
            rel = (config.RELEVANCE_EMBED_WEIGHT * emb
                   + config.RELEVANCE_FOCUS_WEIGHT * min(1.0, len(focus_hits) / 2))
            score = (config.R_CASE_RELEVANCE * rel + config.R_SPECIALTY * spec_fit
                     + config.R_PROXIMITY * prox + config.R_RESPONSIVE * resp + config.R_ROLE * role_fit)
        else:
            rel = None
            w = config.R_NOCASE
            score = (w["specialty"] * spec_fit + w["proximity"] * prox
                     + w["responsive"] * resp + w["role"] * role_fit)

        reasons = []
        if focus_hits:
            reasons.append(f"Focus on {', '.join(focus_hits[:2])}")
        elif not case_text and focus and p.get("focus_areas"):
            reasons.append(f"Focus on {', '.join(p['focus_areas'][:2])}")
        else:
            reasons.append(f"{p['specialty']} · {p.get('subspecialty') or p['credentials']}")
        dist_txt = f"{d:g} mi" if d is not None else "Distance unknown"
        reasons.append(dist_txt + (" · Telehealth available" if p["telehealth"] else ""))
        reasons.append(f"Usually replies within ~{p['avg_response_hours']:g}h")

        results.append({
            "provider": public_summary(p),
            "distance_miles": d,
            "distance_band": distance_band(d),
            "score": round(score, 4),
            "score_breakdown": {"case_relevance": None if rel is None else round(rel, 3),
                                "focus_matches": focus_hits,
                                "specialty_fit": spec_fit, "proximity": round(prox, 3),
                                "responsiveness": round(resp, 3), "role_fit": role_fit},
            "reasons": reasons[:3],
        })

    if sort == "distance":
        results.sort(key=lambda r: (r["distance_miles"] is None,
                                    r["distance_miles"] if r["distance_miles"] is not None else 0,
                                    -r["score"], r["provider"]["id"]))
    else:
        results.sort(key=lambda r: (-r["score"], r["provider"]["id"]))   # id tie-break = deterministic

    return {
        "proximity_source": proximity.name,
        "origin_hcp_id": origin_hcp_id,
        "applied_filters": {
            "specialty": specialty or [], "suggested_specialties": suggested, "role": role or [],
            "focus": focus, "max_distance": max_distance, "include_telehealth": include_telehealth,
            "accepting": accepting, "language": language, "type": referral_type, "sort": sort,
        },
        "total": len(results),
        "results": results[:limit],
    }
