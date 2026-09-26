"""HCP Peer Case Exchange: API.

Flow the React Native app follows:
  1. POST /cases/deidentify     raw text -> redacted text + structured preview (nothing stored)
  2. doctor reviews/edits, then POST /cases with confirmed_deidentified=true
       -> case saved, peers + similar cases + literature + trials returned
  3. peers reply:               POST /cases/{id}/responses
  4. author closes the loop:    POST /cases/{id}/resolve  (indexed only if consent_to_index)
  5. pharma/medical-affairs view: GET /insights (aggregates only, k-anonymity floor)
"""
from collections import Counter
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import config, db, deid, external, llm, vectorstore
from .matching import match_case
from .schemas import (CreateCaseRequest, DeidentifyRequest, FindSimilarRequest, MatchRequest,
                      ResolveRequest, ResponseCreate)
from .structuring import structure_case

@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    yield


app = FastAPI(title="HCP Peer Case Exchange", version="0.1.0", lifespan=lifespan)
# Wide-open CORS is for the hackathon (Expo dev server). Lock this down for anything real.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _require_hcp(hcp_id: str) -> dict:
    h = db.get_hcp(hcp_id)
    if not h:
        raise HTTPException(404, f"HCP {hcp_id} not found")
    return h


def _require_case(case_id: str) -> dict:
    c = db.get_case(case_id)
    if not c:
        raise HTTPException(404, f"Case {case_id} not found")
    return c


async def _full_match(structured: dict, author_hcp_id: str | None, include_evidence: bool) -> dict:
    result = match_case(structured, author_hcp_id)
    literature, trials = [], []
    if include_evidence:
        terms = structured.get("search_terms") or structured.get("suspected_conditions") or []
        literature, trials = await external.evidence(terms)
    result["published_case_reports"] = literature
    result["recruiting_trials"] = trials
    return result


# ---------- System ----------

@app.get("/health")
def health():
    return {"ok": True, "llm": llm.available(), "offline": config.OFFLINE, **vectorstore.counts()}


# ---------- Cases ----------

@app.post("/cases/deidentify")
def deidentify_case(req: DeidentifyRequest):
    """Stateless. Returns the redacted text for the doctor to review, plus a structured preview."""
    result = deid.deidentify(req.raw_text)
    result["structured_preview"] = structure_case(result["redacted_text"], result["age_band"])
    return result


@app.post("/cases", status_code=201)
async def create_case(req: CreateCaseRequest):
    _require_hcp(req.author_hcp_id)
    if not req.confirmed_deidentified:
        raise HTTPException(400, "The author must review and confirm the de-identified text.")

    # Safety net: the doctor may have edited the text after review. Re-run the
    # deterministic pass; if it finds anything, refuse rather than store PHI.
    _, leaked, _ = deid.regex_pass(req.redacted_text)
    if leaked:
        cats = sorted({x["category"] for x in leaked})
        raise HTTPException(422, {"error": "possible_identifiers", "categories": cats,
                                  "hint": "Run /cases/deidentify again on the edited text."})

    structured = (req.structured.model_dump() if req.structured
                  else structure_case(req.redacted_text, None))
    case = db.insert_case(req.author_hcp_id, req.redacted_text, structured, req.consent_to_index)
    match = await _full_match(structured, req.author_hcp_id, include_evidence=True)
    return {"case": case, "match": match}


@app.post("/match")
async def match_preview(req: MatchRequest):
    """Match without saving (e.g. live results while the doctor is still typing)."""
    if req.structured:
        structured = req.structured.model_dump()
    elif req.redacted_text:
        _, leaked, band = deid.regex_pass(req.redacted_text)
        if leaked:
            raise HTTPException(422, "Text contains possible identifiers; de-identify first.")
        structured = structure_case(req.redacted_text, band)
    else:
        raise HTTPException(400, "Provide structured or redacted_text")
    return await _full_match(structured, req.author_hcp_id, req.include_evidence)


@app.get("/cases/{case_id}")
def get_case(case_id: str):
    case = _require_case(case_id)
    return {"case": case, "responses": db.list_responses(case_id)}


@app.post("/cases/{case_id}/responses", status_code=201)
def add_response(case_id: str, req: ResponseCreate):
    case = _require_case(case_id)
    _require_hcp(req.hcp_id)
    if case["status"] != "open":
        raise HTTPException(409, "Case is already resolved")
    _, leaked, _ = deid.regex_pass(req.body)
    if leaked:
        raise HTTPException(422, "Reply appears to contain identifiers; please remove them.")
    return db.insert_response(case_id, req.hcp_id, req.body)


@app.post("/responses/{response_id}/helpful")
def mark_helpful(response_id: str):
    db.mark_helpful(response_id)
    return {"ok": True}


@app.post("/cases/{case_id}/resolve")
def resolve(case_id: str, req: ResolveRequest):
    case = _require_case(case_id)
    if req.resolved_by_hcp_id:
        _require_hcp(req.resolved_by_hcp_id)
    for field in (req.treatment_used, req.outcome):
        if field and deid.regex_pass(field)[1]:
            raise HTTPException(422, "Treatment/outcome text appears to contain identifiers.")
    case = db.resolve_case(case_id, req.final_diagnosis, req.resolved_by_hcp_id,
                           req.treatment_used, req.outcome)
    indexed = False
    if case["consent_to_index"]:
        vectorstore.upsert_case(case)   # the network learns from this case from now on
        indexed = True
    return {"case": case, "indexed_for_future_matching": indexed}


# ---------- Patient page ("Find similar cases" button) ----------

DEMO_HCP_ID = "hcp_demo"


@app.get("/demo")
def demo():
    """The logged-in doctor for the hackathon demo, plus their patient list."""
    h = _require_hcp(DEMO_HCP_ID)
    return {"hcp": h, "patients": db.list_patients(DEMO_HCP_ID)}


@app.get("/hcps/{hcp_id}/patients")
def hcp_patients(hcp_id: str):
    _require_hcp(hcp_id)
    return db.list_patients(hcp_id)


@app.get("/patients/{patient_id}")
def get_patient(patient_id: str):
    p = db.get_patient(patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    return p


def _patient_to_text(p: dict, question: str | None) -> str:
    """Clinical text for this patient. The name is deliberately NOT included; it is
    also passed to de-identification as a known identifier in case the summary
    mentions it. Nothing here is stored or embedded in this form."""
    meds = ", ".join(p.get("medications") or [])
    parts = [f"{p['age']} year old {p.get('sex') or ''}.".replace(" .", "."), p["summary"]]
    if meds:
        parts.append(f"Current medications: {meds}.")
    if question:
        parts.append(question)
    return " ".join(parts)


@app.post("/patients/{patient_id}/find-similar")
async def find_similar(patient_id: str, req: FindSimilarRequest | None = None):
    """Diagram step 1: doctor opens a patient -> de-identify -> vector search ->
    similar resolved cases with diagnosis, treatment used and outcome, plus peers."""
    req = req or FindSimilarRequest()
    p = db.get_patient(patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    d = deid.deidentify(_patient_to_text(p, req.question), known_identifiers=[p["display_name"]])
    structured = structure_case(d["redacted_text"], d["age_band"])
    if req.structured_profile:
        profile = req.structured_profile.model_dump(exclude_none=True)
        # Structured free-text fields still need the same identifier check as narrative input.
        _, leaked, _ = deid.regex_pass(str(profile))
        if leaked:
            raise HTTPException(422, "Structured profile contains possible identifiers; remove them first.")
        for key, value in profile.items():
            if value not in (None, "", []):
                structured[key] = value
    structured["age_band"] = structured.get("age_band") or d["age_band"]
    structured["sex"] = structured.get("sex") or p.get("sex")
    structured["current_medications"] = (structured.get("current_medications")
                                           or p.get("medications") or [])
    d["structured_preview"] = structured
    match = await _full_match(structured, p["hcp_id"], req.include_evidence)
    return {"patient_id": patient_id, "deidentified": d, "match": match}


# ---------- HCPs ----------

@app.get("/hcps")
def list_hcps(limit: int = 50, offset: int = 0):
    return db.list_hcps(limit, offset)


@app.get("/hcps/{hcp_id}")
def get_hcp(hcp_id: str):
    return _require_hcp(hcp_id)


@app.get("/hcps/{hcp_id}/cases")
def hcp_cases(hcp_id: str):
    _require_hcp(hcp_id)
    return db.list_cases_for_author(hcp_id)


# ---------- Aggregated insights (the commercial layer) ----------

@app.get("/insights")
def insights():
    """What pharma medical affairs could see: patterns only, never cases, threads or HCP identities.
    Any group smaller than K_MIN is suppressed."""
    cases = db.resolved_indexed_cases()
    by_specialty = Counter()
    by_dx = Counter()
    tried_before_dx = {}
    for c in cases:
        s = c["structured"] or {}
        spec = (s.get("specialty_hints") or ["Unknown"])[0]
        by_specialty[spec] += 1
        dx = c.get("final_diagnosis")
        if dx:
            by_dx[dx] += 1
            for t in s.get("treatments_tried") or []:
                tried_before_dx.setdefault(dx, Counter())[t.lower()[:60]] += 1

    k = config.K_MIN
    return {
        "k_anonymity_floor": k,
        "resolved_cases_by_specialty": {s: n for s, n in by_specialty.items() if n >= k},
        "top_diagnoses_behind_hard_cases": [{"diagnosis": d, "cases": n}
                                            for d, n in by_dx.most_common() if n >= k],
        "treatments_tried_before_diagnosis": {
            d: [{"treatment": t, "cases": n} for t, n in cnt.most_common(3) if n >= k]
            for d, cnt in tried_before_dx.items() if by_dx[d] >= k
        },
        "suppressed_groups": sum(1 for n in list(by_specialty.values()) + list(by_dx.values()) if n < k),
    }
