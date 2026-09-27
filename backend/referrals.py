"""Formal referral directory, handoff lifecycle, and clinician message threads."""
from datetime import UTC, datetime
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

import clinic
from database import get_db
from keys import next_key
from models import (
    CaseMatch,
    Doctor,
    Patient,
    ReferralMessage,
    ReferralRequest,
)

router = APIRouter(prefix="/referrals", tags=["referrals"])

TRANSITIONS = {
    "sent": {"accepted", "declined", "cancelled"},
    "accepted": {"completed", "cancelled"},
}
OPEN_STATUSES = {"sent", "accepted"}


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class ReferralCreate(BaseModel):
    from_doctor_key: str
    to_doctor_key: str
    patient_key: str
    reason: str = Field(min_length=5, max_length=1000)
    urgency: Literal["routine", "soon", "urgent"] = "routine"

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 5:
            raise ValueError("reason must contain at least 5 non-whitespace characters")
        return cleaned


class ReferralStatusUpdate(BaseModel):
    status: Literal["accepted", "declined", "completed", "cancelled"]
    actor_doctor_key: str
    outcome: str | None = Field(None, max_length=1000)


class ReferralMessageCreate(BaseModel):
    sender_doctor_key: str
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("text must not be blank")
        return cleaned


SPECIALTY_TERMS = {
    "Cardiology": {
        "heart", "cardiac", "cardiology", "arrhythmia", "hypertension", "bnp",
        "chf", "edema", "cardiomyopathy",
    },
    "Dermatology": {"skin", "rash", "dermatitis", "psoriasis", "eczema"},
    "Endocrinology": {"thyroid", "diabetes", "glucose", "endocrine", "hypothyroidism"},
    "Gastroenterology": {"gastrointestinal", "abdominal", "celiac", "stomach", "bowel"},
    "Neurology": {"neurology", "tremor", "parkinson", "seizure", "migraine", "neuropathy"},
    "Primary Care": {"primary", "preventive", "general"},
    "Pulmonology": {"pulmonary", "respiratory", "cough", "asthma", "copd", "breathing"},
    "Rheumatology": {"arthritis", "joint", "rheumatoid", "autoimmune", "rheumatology"},
}
STOP_WORDS = {"with", "from", "that", "this", "have", "history", "patient", "female", "male"}


def _tokens(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 2 and word not in STOP_WORDS}


def _require_doctor(db: Session, doctor_key: str) -> Doctor:
    doctor = db.get(Doctor, doctor_key)
    if doctor is None:
        raise HTTPException(status_code=404, detail=f"Doctor {doctor_key} was not found.")
    return doctor


def _get_referral(db: Session, referral_key: str) -> ReferralRequest:
    referral = db.get(ReferralRequest, referral_key)
    if referral is None:
        raise HTTPException(status_code=404, detail=f"Referral {referral_key} was not found.")
    return referral


def _require_participant(referral: ReferralRequest, doctor_key: str) -> None:
    if doctor_key not in (referral.from_doctor_key, referral.to_doctor_key):
        raise HTTPException(status_code=403, detail="Only the referring and receiving doctors can access this referral.")


def _message_payload(message: ReferralMessage) -> dict:
    return {
        "message_key": message.message_key,
        "referral_key": message.referral_key,
        "sender_doctor_key": message.sender_doctor_key,
        "text": message.text,
        "timestamp": message.created_at.isoformat(),
    }


def _messages(db: Session, referral_key: str, since: datetime | None = None) -> list[dict]:
    query = select(ReferralMessage).where(ReferralMessage.referral_key == referral_key)
    if since is not None:
        query = query.where(ReferralMessage.created_at > since)
    rows = db.scalars(query.order_by(ReferralMessage.created_at, ReferralMessage.message_key)).all()
    return [_message_payload(row) for row in rows]


def _insert_message(db: Session, referral_key: str, sender: str, text: str) -> ReferralMessage:
    message = ReferralMessage(
        message_key=next_key(db, ReferralMessage.message_key, "RM"),
        referral_key=referral_key,
        sender_doctor_key=sender,
        text=text,
        created_at=_utc_now(),
    )
    db.add(message)
    return message


def _similar_doctor_scores(db: Session, patient_key: str) -> dict[str, float]:
    rows = db.scalars(
        select(CaseMatch).where(
            or_(CaseMatch.query_patient_key == patient_key, CaseMatch.candidate_patient_key == patient_key)
        )
    ).all()
    scores: dict[str, float] = {}
    for row in rows:
        doctor_key = row.candidate_doctor_key if row.query_patient_key == patient_key else row.query_doctor_key
        score = row.score if row.score is not None else 0.5
        scores[doctor_key] = max(scores.get(doctor_key, 0.0), max(0.0, min(float(score), 1.0)))
    return scores


def _referral_summary(db: Session, referral: ReferralRequest, viewer: str) -> dict:
    patient = db.get(Patient, referral.patient_key)
    patient_visible = viewer == referral.from_doctor_key or referral.status in {"accepted", "completed"}
    patient_label = patient.name if patient is not None and patient_visible else None
    last_message = db.scalar(
        select(ReferralMessage)
        .where(ReferralMessage.referral_key == referral.referral_key)
        .order_by(ReferralMessage.created_at.desc(), ReferralMessage.message_key.desc())
    )
    return {
        "referral_key": referral.referral_key,
        "from_doctor_key": referral.from_doctor_key,
        "to_doctor_key": referral.to_doctor_key,
        "patient_key": referral.patient_key,
        "patient_label": patient_label,
        "status": referral.status,
        "urgency": referral.urgency,
        "reason": referral.reason,
        "outcome": referral.outcome,
        "created_at": referral.created_at.isoformat(),
        "updated_at": referral.updated_at.isoformat(),
        "message_count": len(_messages(db, referral.referral_key)),
        "last_message": last_message.text if last_message is not None else "",
        "patient_visible": patient_visible,
    }


def _referral_detail(db: Session, referral: ReferralRequest, viewer: str) -> dict:
    _require_participant(referral, viewer)
    patient_visible = viewer == referral.from_doctor_key or referral.status in {"accepted", "completed"}
    patient_handoff = None
    if patient_visible:
        patient = db.get(Patient, referral.patient_key)
        if patient is not None:
            patient_handoff = clinic.build_handoff_summary(db, patient, viewer)
    return {
        "referral": _referral_summary(db, referral, viewer),
        "referring_doctor": clinic.doctor_payload(_require_doctor(db, referral.from_doctor_key)),
        "receiving_doctor": clinic.doctor_payload(_require_doctor(db, referral.to_doctor_key)),
        "patient_visible": patient_visible,
        "patient_handoff": patient_handoff,
        "messages": _messages(db, referral.referral_key),
    }


@router.get("/directory")
def referral_directory(
    doctor: str = Query(..., description="Requesting doctor key"),
    patient_key: str | None = None,
    specialty: str | None = None,
    query: str | None = Query(None, max_length=120),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict:
    requester = _require_doctor(db, doctor)
    patient = clinic._panel_patient(db, patient_key, doctor) if patient_key else None
    rows = db.scalars(select(Doctor).where(Doctor.doctor_key != doctor)).all()
    if specialty:
        rows = [row for row in rows if row.specialty.casefold() == specialty.casefold()]

    case_text = ""
    case_scores: dict[str, float] = {}
    if patient is not None:
        diagnoses = [item.label for item in patient.diagnoses]
        case_text = " ".join([*diagnoses, *json_list(patient.symptoms_json)])
        case_scores = _similar_doctor_scores(db, patient.patient_key)
    if query:
        case_text = f"{case_text} {query}".strip()
    case_tokens = _tokens(case_text)

    results = []
    for provider in rows:
        specialty_terms = SPECIALTY_TERMS.get(provider.specialty, set())
        focus_tokens = _tokens(f"{provider.specialty} {provider.subspecialty_focus}")
        matched = sorted(case_tokens & (specialty_terms | focus_tokens))
        lexical_score = min(1.0, len(matched) / 2)
        similar_score = case_scores.get(provider.doctor_key, 0.0)
        score = 0.7 * lexical_score + 0.3 * similar_score if patient is not None else 0.0
        reasons = []
        if matched:
            reasons.append(f"Case terms match {', '.join(matched[:3])}")
        if similar_score:
            reasons.append("Has a similar-case match in the clinic network")
        results.append({
            "provider": clinic.doctor_payload(provider),
            "score": round(score, 4),
            "reasons": reasons,
        })

    results.sort(key=lambda item: (-item["score"], item["provider"]["display_name"].casefold()))
    return {
        "requesting_doctor_key": requester.doctor_key,
        "patient_key": patient.patient_key if patient is not None else None,
        "specialties": sorted({row.specialty for row in rows}),
        "total": len(results),
        "results": results[:limit],
    }


def json_list(value: str) -> list[str]:
    import json

    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        return []
    return decoded if isinstance(decoded, list) else []


@router.get("/specialties")
def referral_specialties(doctor: str = Query(...), db: Session = Depends(get_db)) -> dict:
    _require_doctor(db, doctor)
    rows = db.scalars(select(Doctor).where(Doctor.doctor_key != doctor)).all()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.specialty] = counts.get(row.specialty, 0) + 1
    return {"specialties": [{"name": key, "count": counts[key]} for key in sorted(counts)]}


@router.post("", status_code=201)
def create_referral(body: ReferralCreate, db: Session = Depends(get_db)) -> dict:
    _require_doctor(db, body.from_doctor_key)
    recipient = _require_doctor(db, body.to_doctor_key)
    patient = clinic._panel_patient(db, body.patient_key, body.from_doctor_key)
    if body.from_doctor_key == body.to_doctor_key:
        raise HTTPException(status_code=422, detail="A referral must be sent to another doctor.")

    now = _utc_now()
    referral = ReferralRequest(
        referral_key=next_key(db, ReferralRequest.referral_key, "RF"),
        from_doctor_key=body.from_doctor_key,
        to_doctor_key=body.to_doctor_key,
        patient_key=patient.patient_key,
        status="sent",
        urgency=body.urgency,
        reason=body.reason.strip(),
        created_at=now,
        updated_at=now,
    )
    db.add(referral)
    db.flush()
    _insert_message(db, referral.referral_key, body.from_doctor_key,
                    f"Referral request ({body.urgency}): {body.reason.strip()}")
    db.commit()
    db.refresh(referral)
    return {
        "referral": _referral_summary(db, referral, body.from_doctor_key),
        "receiving_doctor": clinic.doctor_payload(recipient),
        "messages": _messages(db, referral.referral_key),
    }


@router.get("")
def list_referrals(doctor: str = Query(...), db: Session = Depends(get_db)) -> list[dict]:
    _require_doctor(db, doctor)
    rows = db.scalars(
        select(ReferralRequest)
        .where(or_(ReferralRequest.from_doctor_key == doctor, ReferralRequest.to_doctor_key == doctor))
        .order_by(ReferralRequest.updated_at.desc(), ReferralRequest.referral_key)
    ).all()
    return [_referral_summary(db, row, doctor) for row in rows]


@router.get("/{referral_key}")
def get_referral(referral_key: str, viewer: str = Query(...), db: Session = Depends(get_db)) -> dict:
    referral = _get_referral(db, referral_key)
    _require_participant(referral, viewer)
    return _referral_detail(db, referral, viewer)


@router.post("/{referral_key}/status")
def update_referral_status(
    referral_key: str, body: ReferralStatusUpdate, db: Session = Depends(get_db)
) -> dict:
    referral = _get_referral(db, referral_key)
    actor = body.actor_doctor_key
    _require_participant(referral, actor)
    allowed = TRANSITIONS.get(referral.status, set())
    if body.status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot move referral from {referral.status} to {body.status}.",
        )
    if body.status in {"accepted", "declined"} and actor != referral.to_doctor_key:
        raise HTTPException(status_code=403, detail="Only the receiving doctor can accept or decline.")
    if body.status == "cancelled" and actor != referral.from_doctor_key:
        raise HTTPException(status_code=403, detail="Only the referring doctor can cancel.")
    if body.status == "completed" and not (body.outcome and body.outcome.strip()):
        raise HTTPException(status_code=422, detail="An outcome is required to complete a referral.")

    referral.status = body.status
    referral.updated_at = _utc_now()
    if body.status == "completed":
        referral.outcome = body.outcome.strip() if body.outcome else None
    status_text = {
        "accepted": "accepted the referral.",
        "declined": "declined the referral.",
        "cancelled": "cancelled the referral.",
        "completed": f"completed the referral. Outcome: {referral.outcome}",
    }[body.status]
    _insert_message(db, referral.referral_key, actor, f"[status] {status_text}")
    db.commit()
    db.refresh(referral)
    return _referral_detail(db, referral, actor)


@router.get("/{referral_key}/messages")
def get_referral_messages(
    referral_key: str,
    viewer: str = Query(...),
    since: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    referral = _get_referral(db, referral_key)
    _require_participant(referral, viewer)
    parsed_since = None
    if since:
        try:
            parsed_since = datetime.fromisoformat(since)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="since must be an ISO timestamp.") from exc
    return {"referral_status": referral.status, "messages": _messages(db, referral_key, parsed_since)}


@router.post("/{referral_key}/messages", status_code=201)
def create_referral_message(
    referral_key: str, body: ReferralMessageCreate, db: Session = Depends(get_db)
) -> dict:
    referral = _get_referral(db, referral_key)
    _require_participant(referral, body.sender_doctor_key)
    if referral.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail=f"Referral is {referral.status}; no new messages are allowed.")
    _insert_message(db, referral_key, body.sender_doctor_key, body.text.strip())
    referral.updated_at = _utc_now()
    db.commit()
    message = db.scalar(
        select(ReferralMessage)
        .where(ReferralMessage.referral_key == referral_key)
        .order_by(ReferralMessage.created_at.desc(), ReferralMessage.message_key.desc())
    )
    return _message_payload(message)
