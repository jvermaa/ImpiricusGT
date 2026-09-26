"""Referrals API.

Patient page -> [Refer / Ask] -> GET /referrals/directory?patient_id=...
  -> POST /referrals {type: advice | referral}
  -> chat: GET/POST /referrals/{id}/messages
  -> POST /referrals/{id}/status: accepted -> completed (+ optional feed_network)
"""
from fastapi import APIRouter, HTTPException, Query

from .. import config, db, llm, vectorstore
from ..patient_case import contains_identifiers, deidentified_case
from . import directory
from .schemas import CreateReferral, MessageCreate, StatusUpdate
from .taxonomy import ROLES, SPECIALTIES

router = APIRouter(prefix="/referrals", tags=["referrals"])

TRANSITIONS = {"sent": {"accepted", "declined", "cancelled"},
               "accepted": {"completed", "cancelled"}}
OPEN_STATUSES = {"sent", "accepted"}


# ---------- helpers ----------

def _hcp(hcp_id: str) -> dict:
    h = db.get_hcp(hcp_id)
    if not h:
        raise HTTPException(404, f"HCP {hcp_id} not found")
    return h


def _provider(provider_id: str) -> dict:
    p = directory.get_provider(provider_id)
    if not p:
        raise HTTPException(404, f"Provider {provider_id} not found in the referral directory")
    return p


def _referral(referral_id: str) -> dict:
    r = db.get_referral(referral_id)
    if not r:
        raise HTTPException(404, f"Referral {referral_id} not found")
    return r


def _own_patient(patient_id: str, hcp_id: str) -> dict:
    p = db.get_patient(patient_id)
    if not p:
        raise HTTPException(404, f"Patient {patient_id} not found")
    if p["hcp_id"] != hcp_id:
        raise HTTPException(403, "You can only refer or ask about your own patients")
    return p


def _require_participant(r: dict, who: str) -> None:
    if who not in (r["from_hcp_id"], r["to_provider_id"]):
        raise HTTPException(403, "Only the sender and recipient can view or post in this thread")


def _reject_identifiers(text: str | None, patient: dict | None = None, what: str = "Text") -> None:
    if not text:
        return
    cats = contains_identifiers(text, patient)
    if cats:
        raise HTTPException(422, {"error": "possible_identifiers", "field": what, "categories": cats,
                                  "hint": "Remove names, dates, phone numbers and other identifiers."})


def _validate_choices(values: list[str] | None, valid: list[str], name: str) -> None:
    bad = [v for v in values or [] if v not in valid]
    if bad:
        raise HTTPException(422, {"error": f"unknown {name}", "invalid": bad, "valid": valid})


# ---------- directory ----------

@router.get("/directory")
def get_directory(
    hcp_id: str = Query("hcp_demo", description="The requesting doctor (distance origin)"),
    specialty: list[str] | None = Query(None),
    role: list[str] | None = Query(None),
    focus: str | None = None,
    max_distance: float | None = Query(None, ge=0),
    include_telehealth: bool = True,
    accepting: bool = True,
    language: str | None = None,
    patient_id: str | None = Query(None, description="Case-aware mode: pre-fills specialty from this patient"),
    case_id: str | None = Query(None, description="Case-aware mode from an existing de-identified case"),
    question: str | None = Query(None, max_length=500,
                                 description="What the doctor wants to ask; sharpens the suggestions"),
    type: str = Query("referral", pattern="^(advice|referral)$"),
    sort: str = Query("best", pattern="^(best|distance)$"),
    limit: int = Query(50, ge=1, le=200),
):
    requester = _hcp(hcp_id)
    _validate_choices(specialty, SPECIALTIES, "specialty")
    _validate_choices(role, ROLES, "role")

    structured = None
    if patient_id:
        patient = _own_patient(patient_id, hcp_id)
        _reject_identifiers(question, patient, "question")
        _, structured = deidentified_case(patient, question)
    elif case_id:
        c = db.get_case(case_id)
        if not c:
            raise HTTPException(404, f"Case {case_id} not found")
        structured = c["structured"]

    return directory.search(
        origin_hcp_id=hcp_id, specialty=specialty, role=role, focus=focus,
        max_distance=max_distance, include_telehealth=include_telehealth, accepting=accepting,
        language=language, structured=structured, referral_type=type, sort=sort, limit=limit,
        requester_specialty=requester["specialty"])


@router.get("/specialties")
def get_facets(accepting: bool = True):
    return directory.facets(accepting)


@router.get("/providers/{provider_id}")
def get_provider_detail(provider_id: str, hcp_id: str = "hcp_demo"):
    """Full profile, including street address (list views show city/state only)."""
    from .proximity import distance_band, get_proximity
    p = _provider(provider_id)
    d = get_proximity().distance_miles(hcp_id, p)
    out = {k: v for k, v in p.items() if k != "distance_miles"}
    return {**out, "distance_miles": d, "distance_band": distance_band(d),
            "proximity_source": get_proximity().name}


# ---------- create + list ----------

@router.post("", status_code=201)
def create_referral(req: CreateReferral):
    _hcp(req.from_hcp_id)
    provider = _provider(req.to_provider_id)
    if not provider["accepting_referrals"]:
        raise HTTPException(409, f"{provider['name']} is not accepting referrals right now")

    patient = None
    case_id = None
    if req.type == "referral":
        if not req.patient_id:
            raise HTTPException(422, "A referral needs patient_id")
        patient = _own_patient(req.patient_id, req.from_hcp_id)
        _reject_identifiers(req.reason, patient, "reason")
        first = (f"Referral request ({req.urgency}): {req.reason}\n\n"
                 "Patient details become visible to you once you accept.")
    else:  # advice: de-identified only, never stores patient_id
        if req.patient_id:
            patient = _own_patient(req.patient_id, req.from_hcp_id)
            _reject_identifiers(req.reason, patient, "reason")
            d, structured = deidentified_case(patient)
            case = db.insert_case(req.from_hcp_id, d["redacted_text"], structured, consent_to_index=False)
            case_id = case["id"]
            redacted = d["redacted_text"]
        elif req.case_id:
            case = db.get_case(req.case_id)
            if not case:
                raise HTTPException(404, f"Case {req.case_id} not found")
            if case["author_hcp_id"] != req.from_hcp_id:
                raise HTTPException(403, "You can only ask about your own cases")
            _reject_identifiers(req.reason, None, "reason")
            case_id, redacted = case["id"], case["redacted_text"]
        else:
            raise HTTPException(422, "Advice needs patient_id or case_id")
        first = f"Advice request ({req.urgency}): {req.reason}\n\nDe-identified case: {redacted}"

    r = db.insert_referral(req.from_hcp_id, req.to_provider_id, req.type, req.reason, req.urgency,
                           patient_id=patient["id"] if req.type == "referral" else None,
                           case_id=case_id)
    db.insert_referral_message(r["id"], req.from_hcp_id, first)
    return {"referral": r, "provider": directory.public_summary(provider),
            "messages": db.list_referral_messages(r["id"])}


@router.get("")
def list_referrals(hcp_id: str | None = Query(None, description="Sent by this doctor"),
                   provider_id: str | None = Query(None, description="Received by this provider")):
    if not hcp_id and not provider_id:
        raise HTTPException(422, "Pass hcp_id (sent) or provider_id (received)")
    rows = db.list_referrals(from_hcp_id=hcp_id, to_provider_id=provider_id)
    stats = db.message_stats([r["id"] for r in rows])
    out = []
    for r in rows:
        p = directory.get_provider(r["to_provider_id"])
        out.append({**r, "provider": directory.public_summary(p) if p else None,
                    **stats.get(r["id"], {"message_count": 0, "last_message_at": None})})
    return out


# ---------- one thread ----------

@router.get("/{referral_id}")
def get_referral(referral_id: str, viewer: str = Query(..., description="hcp id or provider id")):
    r = _referral(referral_id)
    _require_participant(r, viewer)
    provider = directory.get_provider(r["to_provider_id"])
    out = {"referral": r, "provider": directory.public_summary(provider) if provider else None,
           "messages": db.list_referral_messages(referral_id)}

    if r["type"] == "advice" and r["case_id"]:
        c = db.get_case(r["case_id"])
        out["case"] = {"redacted_text": c["redacted_text"], "structured": c["structured"]} if c else None
    elif r["type"] == "referral":
        # Treatment handoff: the recipient sees the patient only after accepting.
        visible = viewer == r["from_hcp_id"] or r["status"] in ("accepted", "completed")
        out["patient_visible"] = visible
        if visible and r["patient_id"]:
            p = db.get_patient(r["patient_id"])
            out["patient"] = {k: p[k] for k in ("id", "display_name", "age", "sex", "summary", "medications")}
    return out


@router.post("/{referral_id}/status")
def update_status(referral_id: str, req: StatusUpdate):
    r = _referral(referral_id)
    _require_participant(r, req.actor)
    allowed = TRANSITIONS.get(r["status"], set())
    if req.status not in allowed:
        raise HTTPException(409, f"Cannot go from {r['status']} to {req.status}; allowed: {sorted(allowed) or 'none'}")
    if req.status in ("accepted", "declined") and req.actor != r["to_provider_id"]:
        raise HTTPException(403, "Only the recipient can accept or decline")
    if req.status == "cancelled" and req.actor != r["from_hcp_id"]:
        raise HTTPException(403, "Only the sender can cancel")

    patient = db.get_patient(r["patient_id"]) if r["patient_id"] else None
    fields = {"status": req.status}

    if req.status == "completed":
        if not req.outcome:
            raise HTTPException(422, "outcome is required when completing")
        for name, val in (("outcome", req.outcome), ("final_diagnosis", req.final_diagnosis),
                          ("treatment_used", req.treatment_used)):
            _reject_identifiers(val, patient, name)
        fields["outcome"] = req.outcome

        if req.feed_network:
            if not req.final_diagnosis:
                raise HTTPException(422, "final_diagnosis is required to feed the case network")
            case_id = r["case_id"]
            if not case_id:  # formal referral: build the de-identified case now
                if not patient:
                    raise HTTPException(409, "No case or patient to learn from")
                d, structured = deidentified_case(patient)
                case_id = db.insert_case(r["from_hcp_id"], d["redacted_text"], structured,
                                         consent_to_index=True)["id"]
            db.set_case_consent(case_id, True)
            provider = directory.get_provider(r["to_provider_id"]) or {}
            case = db.resolve_case(case_id, req.final_diagnosis, provider.get("hcp_id"),
                                   req.treatment_used, req.outcome)
            vectorstore.upsert_case(case)
            fields.update(case_id=case_id, fed_network=True)

    updated = db.update_referral(referral_id, **fields)
    note = {"accepted": "accepted the request", "declined": "declined the request",
            "completed": f"marked this complete. Outcome: {req.outcome}", "cancelled": "cancelled the request"}
    db.insert_referral_message(referral_id, req.actor, f"[status] {note[req.status]}")
    return {"referral": updated, "indexed_for_future_matching": bool(updated["fed_network"])}


# ---------- chat ----------

@router.get("/{referral_id}/messages")
def get_messages(referral_id: str, viewer: str = Query(...),
                 since: str | None = Query(None, description="ISO timestamp of the last message you have")):
    r = _referral(referral_id)
    _require_participant(r, viewer)
    return {"referral_status": r["status"], "messages": db.list_referral_messages(referral_id, since)}


@router.post("/{referral_id}/messages", status_code=201)
def post_message(referral_id: str, req: MessageCreate):
    r = _referral(referral_id)
    _require_participant(r, req.sender)
    if r["status"] not in OPEN_STATUSES:
        raise HTTPException(409, f"Thread is {r['status']}; no new messages")
    patient = db.get_patient(r["patient_id"]) if r["patient_id"] else None
    _reject_identifiers(req.body, patient, "body")
    return db.insert_referral_message(referral_id, req.sender, req.body)


REPLY_SYSTEM = """You are {name}, {credentials}, {specialty} ({subspecialty}), replying to a colleague
in a clinician-to-clinician message thread. Reply in 2-4 sentences: practical, collegial, and hedged
("I'd consider...", "worth checking..."). Do not invent patient details, names, dates or places.
Do not give a definitive diagnosis. Return {{"reply": "<text>"}}."""


@router.post("/{referral_id}/simulate-reply", status_code=201)
def simulate_reply(referral_id: str):
    """DEMO ONLY: directory providers aren't real users, so this posts a plausible
    reply as the recipient. Disabled unless PCX_DEMO=1."""
    if not config.DEMO:
        raise HTTPException(404, "Not found")
    r = _referral(referral_id)
    if r["status"] not in OPEN_STATUSES:
        raise HTTPException(409, f"Thread is {r['status']}")
    p = _provider(r["to_provider_id"])
    history = db.list_referral_messages(referral_id)[-6:]
    transcript = "\n".join(f"{'Colleague' if m['sender'] == r['from_hcp_id'] else 'You'}: {m['body']}"
                           for m in history)
    result = llm.complete_json(REPLY_SYSTEM.format(
        name=p["name"], credentials=p["credentials"], specialty=p["specialty"],
        subspecialty=p.get("subspecialty") or "general"), transcript, max_tokens=400)
    reply = (result or {}).get("reply")
    if not reply or contains_identifiers(reply):
        focus = ", ".join((p.get("focus_areas") or [p["specialty"]])[:2])
        reply = (f"Thanks for sending this. From a {p['specialty'].lower()} perspective, this overlaps "
                 f"with what I see in {focus}. I'd be glad to review further. "
                 + ("Happy to see the patient; accept on my side and send over recent labs."
                    if r["type"] == "referral" else "Could you share recent labs and what's been tried so far?"))
    return db.insert_referral_message(referral_id, r["to_provider_id"], reply)
