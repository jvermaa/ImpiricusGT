"""Deterministic specialty filter, then a Gemini re-rank limited to those candidates."""

import json
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

import clinic
from database import get_db
from gemini_client import generate_text
from keys import next_key
from models import (
    Allergy,
    ConsultThread,
    Diagnosis,
    Doctor,
    Message,
    Patient,
    PatientReferral,
)
from specialty_map import FALLBACK_SPECIALTY, specialty_for_code

router = APIRouter()

_CACHE: dict[tuple[str, str, int], tuple[float, list[dict]]] = {}
_CACHE_SECONDS = 10 * 60


class AskBody(BaseModel):
    to_doctor_key: str


class ReferralBody(BaseModel):
    to_doctor_key: str
    reason: str = Field(min_length=1, max_length=500)


def _languages(doctor: Doctor) -> list[str]:
    try:
        decoded = json.loads(doctor.languages_json)
    except (TypeError, ValueError):
        return []
    return [str(item) for item in decoded] if isinstance(decoded, list) else []


def _score(doctor: Doctor, patient: Patient, diagnoses: list[Diagnosis]) -> tuple[int, list[str]]:
    targets = {specialty_for_code(row.code) for row in diagnoses} or {FALLBACK_SPECIALTY}
    labels = [row.label for row in diagnoses if row.label]
    notes: list[str] = []
    points = 0
    if doctor.specialty in targets:
        points += 55
        notes.append(doctor.specialty)
    elif doctor.specialty == FALLBACK_SPECIALTY:
        points += 20
        notes.append(FALLBACK_SPECIALTY)
    focus = doctor.subspecialty_focus.casefold()
    if any(label.casefold() in focus or focus in label.casefold() for label in labels):
        points += 20
        notes.append(doctor.subspecialty_focus)
    if doctor.state == patient.state:
        points += 15
        notes.append("same state")
    if any(language.casefold() == patient.preferred_language.casefold() for language in _languages(doctor)):
        points += 7
        notes.append(f"speaks {patient.preferred_language}")
    points += min(3, doctor.years_in_practice // 15)
    return min(points, 100), notes


def rule_reason(doctor: Doctor, patient: Patient, diagnoses: list[Diagnosis]) -> str:
    _points, notes = _score(doctor, patient, diagnoses)
    headline = notes[:3] or [doctor.specialty]
    return " · ".join(headline)[:120]


def candidate_doctors(
    db: Session, patient: Patient, requester_key: str, diagnoses: list[Diagnosis]
) -> list[tuple[Doctor, int]]:
    excluded = {requester_key, patient.primary_doctor_key}
    rows = db.scalars(
        select(Doctor).where(
            Doctor.accepts_peer_consults.is_(True),
            Doctor.doctor_key.not_in(excluded),
        )
    ).all()
    scored = [(doctor, _score(doctor, patient, diagnoses)[0]) for doctor in rows]
    scored.sort(key=lambda item: (-item[1], item[0].doctor_key))
    return scored[:8]


def _deidentified_payload(patient: Patient, diagnoses: list[Diagnosis], allergies: list[Allergy]) -> dict:
    return {
        "age_group": patient.age_group,
        "state": patient.state,
        "diagnoses": [{"label": row.label, "code": row.code} for row in diagnoses],
        "allergy_substances": [row.substance for row in allergies],
        "preferred_language": patient.preferred_language,
        "interpreter_needed": patient.preferred_language.casefold() != "english",
    }


def _candidate_payload(doctor: Doctor) -> dict:
    return {
        "doctor_key": doctor.doctor_key,
        "specialty": doctor.specialty,
        "subspecialty_focus": doctor.subspecialty_focus,
        "state": doctor.state,
        "languages": _languages(doctor),
        "practice_type": doctor.practice_type,
        "years_in_practice": doctor.years_in_practice,
    }


def _parse_rank(raw: str | None, allowed: set[str]) -> list[tuple[str, str]]:
    if not raw:
        return []
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.removeprefix("json").strip()
    try:
        payload = json.loads(text)
    except ValueError:
        return []
    if isinstance(payload, dict):
        payload = payload.get("suggestions") or payload.get("results") or []
    if not isinstance(payload, list):
        return []
    chosen: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        key = str(item.get("doctor_key") or "")
        if key not in allowed or key in seen:
            continue
        reason = str(item.get("reason") or "").strip()
        words = reason.split()
        if len(words) > 20:
            reason = " ".join(words[:20])
        if not reason:
            continue
        seen.add(key)
        chosen.append((key, reason))
        if len(chosen) == 3:
            break
    return chosen


def suggest(db: Session, patient: Patient, requester_key: str, limit: int) -> list[dict]:
    cache_key = (patient.patient_key, requester_key, limit)
    cached = _CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1]

    diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.patient_key == patient.patient_key)).all()
    allergies = db.scalars(select(Allergy).where(Allergy.patient_key == patient.patient_key)).all()
    ranked = candidate_doctors(db, patient, requester_key, diagnoses)
    by_key = {doctor.doctor_key: (doctor, score) for doctor, score in ranked}
    prompt = (
        "Rank at most 3 clinicians for a de-identified referral. "
        "Use only doctor_key values from the candidate list. "
        'Return JSON only: [{"doctor_key": "...", "reason": "20 words or fewer"}]. '
        "Do not invent clinicians. Do not include names or contact details.\n"
        f"Patient: {json.dumps(_deidentified_payload(patient, diagnoses, allergies))}\n"
        f"Candidates: {json.dumps([_candidate_payload(doctor) for doctor, _score in ranked])}"
    )
    try:
        raw = generate_text(prompt)
    except Exception:
        raw = None
    gemini_order = _parse_rank(raw, set(by_key))
    picked: list[tuple[str, str, str]] = [
        (key, reason, "gemini") for key, reason in gemini_order
    ]
    if not picked:
        picked = [
            (doctor.doctor_key, rule_reason(doctor, patient, diagnoses), "rules")
            for doctor, _score in ranked[:limit]
        ]
    else:
        seen = {key for key, _reason, _source in picked}
        for doctor, _score in ranked:
            if len(picked) >= limit:
                break
            if doctor.doctor_key in seen:
                continue
            picked.append((doctor.doctor_key, rule_reason(doctor, patient, diagnoses), "rules"))
    items = []
    for key, reason, source in picked[:limit]:
        doctor, score = by_key[key]
        items.append(
            {
                "doctor_key": doctor.doctor_key,
                "display_name": doctor.display_name,
                "initials": clinic._initials(doctor.display_name),
                "specialty_title": clinic._specialty_title(doctor.specialty),
                "state": doctor.state,
                "languages": _languages(doctor),
                "match_score": score,
                "reason": reason,
                "ranked_by": source,
            }
        )
    _CACHE[cache_key] = (time.monotonic(), items)
    return items


def _case_summary(patient: Patient, diagnoses: list[Diagnosis]) -> str:
    described = ", ".join(f"{row.label} ({row.code})" for row in diagnoses) or "unspecified"
    return (
        f"De-identified case: age group {patient.age_group}, state {patient.state}, "
        f"language {patient.preferred_language}. Conditions: {described}. "
        "No name or contact details are included. Please advise on a consult or referral."
    )


def open_consult(db: Session, patient: Patient, requester_key: str, peer_key: str) -> dict:
    if peer_key == requester_key:
        raise HTTPException(status_code=422, detail="A consult needs two different doctors.")
    requester = clinic._require_doctor(db, requester_key)
    peer = clinic._require_doctor(db, peer_key)
    if not requester.accepts_peer_consults or not peer.accepts_peer_consults:
        raise HTTPException(status_code=403, detail="Both doctors must accept peer consults.")
    diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.patient_key == patient.patient_key)).all()
    low, high = clinic._ordered_pair(requester_key, peer_key)
    thread = db.scalar(
        select(ConsultThread).where(
            ConsultThread.doctor_low_key == low,
            ConsultThread.doctor_high_key == high,
        )
    )
    created = False
    if thread is None:
        thread = ConsultThread(
            thread_key=next_key(db, ConsultThread.thread_key, "T"),
            doctor_low_key=low,
            doctor_high_key=high,
            created_at=datetime.utcnow(),
        )
        db.add(thread)
        db.flush()
        created = True
    existing = db.scalar(select(Message).where(Message.thread_key == thread.thread_key))
    message = None
    if existing is None:
        message = Message(
            message_key=next_key(db, Message.message_key, "M"),
            thread_key=thread.thread_key,
            sender_doctor_key=requester_key,
            text=_case_summary(patient, diagnoses),
            created_at=datetime.utcnow(),
        )
        db.add(message)
    clinic._commit(db)
    return {
        "thread_key": thread.thread_key,
        "peer_doctor_key": peer.doctor_key,
        "created": created,
        "opening_message": message.text if message is not None else None,
    }


def record_referral(db: Session, patient: Patient, requester_key: str, peer_key: str, reason: str) -> dict:
    if requester_key != patient.primary_doctor_key:
        raise HTTPException(status_code=403, detail="Only the patient's primary doctor can refer.")
    if requester_key == peer_key:
        raise HTTPException(status_code=422, detail="A referral needs two different doctors.")
    peer = clinic._require_doctor(db, peer_key)
    if not peer.accepts_peer_consults:
        raise HTTPException(status_code=403, detail="That doctor does not accept peer consults.")
    pending = db.scalar(
        select(PatientReferral).where(
            PatientReferral.patient_key == patient.patient_key,
            PatientReferral.to_doctor_key == peer_key,
            PatientReferral.status == "pending",
        )
    )
    if pending is not None:
        raise HTTPException(status_code=409, detail="A pending referral to that doctor already exists.")
    row = PatientReferral(
        patient_key=patient.patient_key,
        from_doctor_key=requester_key,
        to_doctor_key=peer_key,
        reason=reason.strip(),
        status="pending",
        created_at=datetime.utcnow(),
    )
    db.add(row)
    clinic._commit(db)
    db.refresh(row)
    return _referral_payload(row)


def _referral_payload(row: PatientReferral) -> dict:
    return {
        "id": row.id,
        "patient_key": row.patient_key,
        "from_doctor_key": row.from_doctor_key,
        "to_doctor_key": row.to_doctor_key,
        "reason": row.reason,
        "status": row.status,
        "created_at": row.created_at.isoformat(),
        "direction": None,
    }


@router.get("/patients/{patient_key}/referral-suggestions")
def referral_suggestions(
    patient_key: str,
    doctor: str = Query(...),
    limit: int = Query(3, ge=2, le=3),
    db: Session = Depends(get_db),
) -> list[dict]:
    patient = clinic._panel_patient(db, patient_key, doctor)
    return suggest(db, patient, doctor, limit)


@router.post("/patients/{patient_key}/asks", status_code=201)
def ask_doctor(
    patient_key: str,
    body: AskBody,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = clinic._panel_patient(db, patient_key, doctor)
    return open_consult(db, patient, doctor, body.to_doctor_key)


@router.post("/patients/{patient_key}/referrals", status_code=201)
def refer_doctor(
    patient_key: str,
    body: ReferralBody,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = clinic._panel_patient(db, patient_key, doctor)
    return record_referral(db, patient, doctor, body.to_doctor_key, body.reason)


@router.get("/referral-records")
def list_referral_records(doctor: str = Query(...), db: Session = Depends(get_db)) -> dict:
    clinic._require_doctor(db, doctor)
    rows = db.scalars(
        select(PatientReferral)
        .where(
            or_(
                PatientReferral.from_doctor_key == doctor,
                PatientReferral.to_doctor_key == doctor,
            )
        )
        .order_by(PatientReferral.created_at.desc())
    ).all()
    outgoing = []
    incoming = []
    for row in rows:
        payload = _referral_payload(row)
        if row.from_doctor_key == doctor:
            payload["direction"] = "outgoing"
            outgoing.append(payload)
        else:
            payload["direction"] = "incoming"
            incoming.append(payload)
    return {"incoming": incoming, "outgoing": outgoing}
