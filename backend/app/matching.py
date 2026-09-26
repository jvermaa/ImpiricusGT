"""Matching engine.

Given a structured, de-identified case it returns:
  * similar_cases      - resolved, consented cases from OTHER HCPs, nearest first
  * diagnoses_seen     - final diagnoses from those cases, weighted by similarity
                         (this is the "what did other patients turn out to have"
                         signal, built only from cases doctors chose to share)
  * peers              - HCPs ranked by a blend of expertise fit, having
                         resolved/answered similar cases, specialty fit and
                         responsiveness, each with human-readable reasons
"""
from . import config, db
from .embeddings import get_embedder
from .vectorstore import case_document, expert_hcps, hcp_document, similar_cases


def _dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _specialty_fit(specialty: str, hints: list[str]) -> float:
    if not hints:
        return 0.0
    if specialty == hints[0]:
        return 1.0
    return 0.7 if specialty in hints else 0.0


def _ensure_cross_specialty(peers: list[dict], hints: list[str], n: int) -> list[dict]:
    """Hard cases often sit between specialties. If the case points at a second
    specialty and none of the top-n peers are from it, promote its best peer."""
    if len(hints) < 2 or len(peers) <= n:
        return peers
    top = peers[:n]
    if any(p["specialty"] in hints[1:] for p in top):
        return peers
    alt = next((p for p in peers[n:] if p["specialty"] in hints[1:]), None)
    if not alt:
        return peers
    alt["reasons"] = ["Second-specialty perspective on this case"] + alt["reasons"]
    return top[:-1] + [alt] + [p for p in peers[n:] if p is not alt] + [top[-1]]


def _symptom_names(structured: dict) -> list[str]:
    symptoms = structured.get("symptoms") or []
    names = [s.get("name", "") if isinstance(s, dict) else str(s) for s in symptoms]
    return [name for name in names if name]


def match_case(structured: dict, author_hcp_id: str | None, top_peers: int = 5,
               top_cases: int = 5) -> dict:
    embedder = get_embedder()
    vec = embedder.embed([case_document(structured)])[0]
    hints = structured.get("specialty_hints") or []

    # 1. Similar resolved cases from other HCPs
    hits = [h for h in similar_cases(vec, author_hcp_id, k=15)
            if h["similarity"] >= config.SIMILAR_CASE_MIN_SIM]
    case_rows = db.get_cases([h["id"] for h in hits])
    responders = db.responders_by_case([h["id"] for h in hits])

    similar, dx_agg = [], {}
    evidence: dict[str, dict] = {}   # hcp_id -> {"score": float, "resolved": [...], "answered": [...]}
    for h in hits:
        row = case_rows.get(h["id"])
        if (not row or row.get("status") != "resolved" or not row.get("consent_to_index")):
            continue
        sim = h["similarity"]
        dx = row.get("final_diagnosis")
        case_structured = row.get("structured") or {}
        detail_fields = (
            "age_band", "sex", "chief_complaint", "symptoms", "key_findings",
            "suspected_conditions", "treatments_tried", "past_medical_history",
            "family_medical_history", "current_medications", "social_history",
            "lab_results", "pregnancy_status", "immune_status", "clinical_question",
        )
        similar.append({
            "case_id": row["id"],
            "similarity": sim,
            "similarity_score": sim,
            "score_type": "vector_similarity_not_diagnostic_probability",
            "summary": {
                "age_band": case_structured.get("age_band"),
                "sex": case_structured.get("sex"),
                "symptoms": _symptom_names(case_structured)[:3],
            },
            "details": {k: case_structured.get(k) for k in detail_fields},
            "final_diagnosis": dx,
            "treatment_used": row.get("treatment_used"),
            "outcome": row.get("outcome"),
            "resolved_by_hcp_id": row.get("resolved_by_hcp_id"),
        })
        if dx:
            a = dx_agg.setdefault(dx, {"diagnosis": dx, "case_count": 0, "weight": 0.0,
                                       "top_similarity": 0.0, "treatments": []})
            a["case_count"] += 1
            t = row.get("treatment_used")
            if t and t not in a["treatments"]:
                a["treatments"].append(t)
            a["weight"] += sim
            a["top_similarity"] = max(a["top_similarity"], sim)

        if row.get("resolved_by_hcp_id"):
            e = evidence.setdefault(row["resolved_by_hcp_id"], {"score": 0.0, "resolved": [], "answered": []})
            e["score"] = max(e["score"], sim)
            e["resolved"].append(dx)
        for rid in responders.get(row["id"], set()):
            if rid == row.get("resolved_by_hcp_id"):
                continue
            e = evidence.setdefault(rid, {"score": 0.0, "resolved": [], "answered": []})
            e["score"] = max(e["score"], sim * 0.6)
            e["answered"].append(dx)

    diagnoses_seen = sorted(dx_agg.values(), key=lambda d: -d["weight"])
    if diagnoses_seen:
        # Only show diagnoses from cases that are genuinely close to the best match.
        best = max(d["top_similarity"] for d in diagnoses_seen)
        diagnoses_seen = [
            d for d in diagnoses_seen
            if d["top_similarity"] >= max(config.SIMILAR_CASE_MIN_SIM + 0.1, 0.75 * best)
            and (d["case_count"] >= config.DX_MIN_AGREEING
                 or d["top_similarity"] >= config.DX_SINGLE_CASE_SIM)
        ]
    for d in diagnoses_seen:
        d["weight"] = round(d["weight"], 3)

    # 2. Expertise matches
    expertise = {h["id"]: h["similarity"] for h in expert_hcps(vec, k=25)}
    # Make sure every specialty the case points at has candidates, not just the dominant one.
    for spec in hints[:3]:
        for h in expert_hcps(vec, k=5, specialty=spec):
            expertise.setdefault(h["id"], h["similarity"])

    candidate_ids = (set(expertise) | set(evidence)) - {author_hcp_id}
    hcps = db.get_hcps(list(candidate_ids))

    # HCPs found only via case evidence need an expertise score too
    missing = [hid for hid in hcps if hid not in expertise]
    if missing:
        vecs = embedder.embed([hcp_document(hcps[m]) for m in missing])
        for hid, v in zip(missing, vecs):
            expertise[hid] = round(_dot(vec, v), 4)

    peers = []
    for hid, h in hcps.items():
        if not h.get("accepting_cases", True):
            continue
        ev = evidence.get(hid, {"score": 0.0, "resolved": [], "answered": []})
        exp_s = max(0.0, expertise.get(hid, 0.0))
        spec_s = _specialty_fit(h["specialty"], hints)
        resp_s = float(h.get("response_rate") or 0)
        score = (config.W_EXPERTISE * exp_s + config.W_CASE_EVIDENCE * ev["score"]
                 + config.W_SPECIALTY * spec_s + config.W_RESPONSIVE * resp_s)

        reasons = []
        if ev["resolved"]:
            dxs = ", ".join(sorted({d for d in ev["resolved"] if d}))
            reasons.append(f"Resolved {len(ev['resolved'])} similar case(s): {dxs}")
        if ev["answered"]:
            reasons.append(f"Advised on {len(ev['answered'])} similar case(s)")
        focus = [f for f in (h.get("focus_areas") or [])][:2]
        if focus:
            reasons.append(f"{h['specialty']}; focus on {', '.join(focus)}")
        if h.get("avg_response_hours"):
            reasons.append(f"Usually replies within ~{round(h['avg_response_hours'])}h")

        peers.append({
            "hcp_id": hid,
            "display_name": h["display_name"],
            "specialty": h["specialty"],
            "subspecialty": h.get("subspecialty"),
            "score": round(score, 4),
            "score_breakdown": {"expertise": round(exp_s, 3), "case_evidence": round(ev["score"], 3),
                                "specialty_fit": spec_s, "responsiveness": resp_s},
            "reasons": reasons,
            "is_synthetic": h.get("is_synthetic", True),
        })
    peers.sort(key=lambda p: -p["score"])
    peers = _ensure_cross_specialty(peers, hints, top_peers)

    note = None
    if similar and not diagnoses_seen:
        note = ("Some loosely related cases exist, but none agree strongly enough to suggest a "
                "diagnosis. This may be a genuinely new pattern: peers are matched on expertise.")
    if not similar:
        note = ("No sufficiently similar resolved cases in the network yet. Peers are matched on "
                "expertise, and published case reports and trials are shown below.")

    return {
        "similar_cases": similar[:top_cases],
        "diagnoses_seen": diagnoses_seen[:5],
        "peers": peers[:top_peers],
        "network_note": note,
        "disclaimer": ("Diagnoses and treatments shown are what happened in other de-identified cases, "
                       "not a diagnosis or treatment recommendation for this patient. Similarity scores "
                       "are not diagnostic probabilities. Clinical "
                       "decisions remain with the treating clinician."),
    }
