"""Formal referral directory, handoff lifecycle, and clinician message threads."""
from datetime import UTC, datetime, timedelta
import hashlib
import html
import os
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

import clinic
import events
import notifications as notification_store
import push as push_service
from assist import _plain, _send_email
from database import get_db
from keys import next_key
from models import (
    CaseMatch,
    Doctor,
    DoctorNotification,
    Patient,
    ReferralConsentToken,
    ReferralMessage,
    ReferralRequest,
)

router = APIRouter(prefix="/referrals", tags=["referrals"])

TRANSITIONS = {
    "pending_patient_consent": {"cancelled"},
    "shared_with_specialist": {"accepted", "declined", "cancelled"},
    # Legacy alias used by older rows / clients.
    "sent": {"accepted", "declined", "cancelled"},
    "accepted": {"completed", "cancelled"},
}
OPEN_STATUSES = {"pending_patient_consent", "shared_with_specialist", "sent", "accepted"}
SPECIALIST_VISIBLE_STATUSES = {"shared_with_specialist", "sent", "accepted", "completed"}
CONSENT_TOKEN_TTL_HOURS = int(os.getenv("REFERRAL_CONSENT_TTL_HOURS", "168"))


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _public_base_url() -> str:
    return (
        os.getenv("PUBLIC_API_BASE_URL", "").strip()
        or os.getenv("PUBLIC_APP_URL", "").strip()
        or "http://localhost:8000"
    ).rstrip("/")


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _patient_visible(referral: ReferralRequest, viewer: str) -> bool:
    if viewer == referral.from_doctor_key:
        return True
    if viewer == referral.to_doctor_key and referral.status in SPECIALIST_VISIBLE_STATUSES:
        return True
    return False


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
    patient_visible = _patient_visible(referral, viewer)
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
    patient_visible = _patient_visible(referral, viewer)
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
        case_text = " ".join([*diagnoses, *json_list(patient.latest_visit_symptoms_json)])
        case_scores = _similar_doctor_scores(db, patient.patient_key)
    if query:
        case_text = f"{case_text} {query}".strip()
    case_tokens = _tokens(case_text)

    results = []
    for provider in rows:
        if not provider.accepts_peer_consults:
            continue
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
    if not isinstance(decoded, list):
        return []
    flattened: list[str] = []
    for item in decoded:
        if isinstance(item, str):
            flattened.append(item)
        elif isinstance(item, dict):
            for key in ("name", "duration", "frequency", "trigger", "onset"):
                token = item.get(key)
                if isinstance(token, str) and token.strip():
                    flattened.append(token.strip())
    return flattened


@router.get("/specialties")
def referral_specialties(doctor: str = Query(...), db: Session = Depends(get_db)) -> dict:
    _require_doctor(db, doctor)
    rows = db.scalars(select(Doctor).where(Doctor.doctor_key != doctor)).all()
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.specialty] = counts.get(row.specialty, 0) + 1
    return {"specialties": [{"name": key, "count": counts[key]} for key in sorted(counts)]}


def _consent_links(raw_token: str) -> tuple[str, str]:
    base = f"{_public_base_url()}/referrals/consent"
    approve = f"{base}?token={raw_token}&decision=approve"
    decline = f"{base}?token={raw_token}&decision=decline"
    return approve, decline


def _issue_consent_token(db: Session, referral_key: str) -> str:
    raw = secrets.token_urlsafe(32)
    now = _utc_now()
    row = ReferralConsentToken(
        token_key=next_key(db, ReferralConsentToken.token_key, "CT"),
        referral_key=referral_key,
        token_hash=_hash_token(raw),
        expires_at=now + timedelta(hours=CONSENT_TOKEN_TTL_HOURS),
        used_at=None,
        decision=None,
        created_at=now,
    )
    db.add(row)
    db.flush()
    return raw


def _consent_email_html(
    *,
    patient_name: str,
    referring_name: str,
    specialist_name: str,
    specialty: str,
    organization: str,
    state: str,
    reason: str,
    urgency: str,
    approve_url: str,
    decline_url: str,
) -> str:
    safe = html.escape
    return f"""
<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1a1a1a;max-width:560px">
  <p>Hello {safe(patient_name)},</p>
  <p>
    Your clinician <strong>{safe(referring_name)}</strong> would like to refer you to
    <strong>{safe(specialist_name)}</strong> ({safe(specialty)}).
  </p>
  <p>
    <strong>Specialist details</strong><br/>
    {safe(specialist_name)}<br/>
    {safe(specialty)} · {safe(organization)} · {safe(state)}
  </p>
  <p><strong>Reason ({safe(urgency)}):</strong> {safe(reason)}</p>
  <p>Please choose one option. Your medical history is shared with the specialist only if you approve.</p>
  <p style="margin:24px 0">
    <a href="{safe(approve_url)}"
       style="background:#2E8B7A;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;margin-right:10px">
      Approve referral
    </a>
    <a href="{safe(decline_url)}"
       style="background:#C45B7A;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">
      Decline referral
    </a>
  </p>
  <p style="font-size:12px;color:#666">
    If the buttons do not work, open these links:<br/>
    Approve: {safe(approve_url)}<br/>
    Decline: {safe(decline_url)}
  </p>
</div>
""".strip()


def _send_consent_email(
    *,
    referring: Doctor,
    recipient: Doctor,
    patient: Patient,
    reason: str,
    urgency: str,
    raw_token: str,
) -> dict:
    approve_url, decline_url = _consent_links(raw_token)
    intended = os.getenv("EMAIL_REDIRECT_TO", "").strip() or os.getenv("SMTP_FROM", "").strip()
    if not intended:
        return {
            "status": "skipped",
            "detail": "no destination",
            "approve_url": approve_url,
            "decline_url": decline_url,
        }
    specialty = clinic._specialty_title(recipient.specialty)
    subject = f"Action needed: referral to {recipient.display_name}"
    plain = (
        f"Hello {patient.name},\n\n"
        f"Your clinician {referring.display_name} would like to refer you to "
        f"{recipient.display_name} ({specialty}).\n\n"
        f"Specialist details\n"
        f"- Name: {recipient.display_name}\n"
        f"- Specialty: {specialty}\n"
        f"- Organization: {recipient.organization}\n"
        f"- State: {recipient.state}\n\n"
        f"Reason for referral ({urgency}): {reason}\n\n"
        f"Approve referral:\n{approve_url}\n\n"
        f"Decline referral:\n{decline_url}\n\n"
        f"Your medical history is shared with the specialist only if you approve.\n"
    )
    html_body = _consent_email_html(
        patient_name=patient.name,
        referring_name=referring.display_name,
        specialist_name=recipient.display_name,
        specialty=specialty,
        organization=recipient.organization,
        state=recipient.state,
        reason=reason,
        urgency=urgency,
        approve_url=approve_url,
        decline_url=decline_url,
    )
    delivery = _send_email(subject, plain, intended, html=html_body)
    return {**delivery, "approve_url": approve_url, "decline_url": decline_url}


def _send_specialist_handoff_email(
    *,
    referring: Doctor,
    recipient: Doctor,
    patient: Patient,
    reason: str,
    urgency: str,
    handoff: dict,
) -> dict:
    intended = os.getenv("EMAIL_REDIRECT_TO", "").strip() or os.getenv("SMTP_FROM", "").strip()
    if not intended:
        return {"status": "skipped", "detail": "no destination"}
    subject = f"Patient consent granted: {patient.name} → {recipient.display_name}"
    body = (
        f"Patient {patient.name} approved the referral from {referring.display_name}.\n\n"
        f"Reason ({urgency}): {reason}\n\n"
        f"Handoff summary\n"
        f"Patient: {handoff.get('patient_display_label')} ({handoff.get('age_group')})\n"
        f"Symptoms: {_plain(handoff.get('symptoms'))}\n"
        f"Diagnoses: {_plain(handoff.get('diagnoses'))}\n"
        f"Allergies: {_plain(handoff.get('allergies'))}\n"
        f"Prescriptions: {_plain(handoff.get('active_prescriptions'))}\n"
        f"Labs: {_plain(handoff.get('labs'))}\n"
        f"Visits: {_plain(handoff.get('encounters'))}\n"
    )
    return _send_email(subject, body, intended)


def _notify_referring_doctor(
    db: Session,
    *,
    referral: ReferralRequest,
    patient: Patient,
    specialist: Doctor,
    decision: str,
) -> DoctorNotification:
    approved = decision == "approve"
    title = "Patient approved referral" if approved else "Patient declined referral"
    preview = (
        f"{patient.name} approved sharing with {specialist.display_name}."
        if approved
        else f"{patient.name} declined the referral to {specialist.display_name}."
    )
    row = notification_store.insert_notification(
        db,
        doctor_key=referral.from_doctor_key,
        type="clinical_update",
        title=title,
        sender="Referral desk",
        brand="Impiricus Referrals",
        preview=preview,
        body=preview,
        opens_chat=False,
        unread_count=1,
        info_card={
            "title": title,
            "sections": [
                {"label": "Patient", "value": patient.name},
                {"label": "Specialist", "value": specialist.display_name},
                {"label": "Referral", "value": referral.referral_key},
                {"label": "Decision", "value": decision},
            ],
        },
        commit=False,
        push=False,
    )
    events.publish(
        {
            "type": "referral_consent",
            "doctor_key": referral.from_doctor_key,
            "referral_key": referral.referral_key,
            "decision": decision,
            "status": referral.status,
            "notification_id": row.notification_key,
            "patient_key": referral.patient_key,
            "to_doctor_key": referral.to_doctor_key,
            "title": title,
            "body": preview,
        }
    )
    return row


def _alert_after_commit(db: Session, row: DoctorNotification) -> None:
    push_service.notify_doctor_devices(
        db,
        doctor_key=row.doctor_key,
        title=row.title,
        body=row.preview or row.body,
        data={
            "notification_id": row.notification_key,
            "type": row.type,
            "doctor_key": row.doctor_key,
        },
    )


def _consent_result_page(*, title: str, body: str, ok: bool) -> HTMLResponse:
    tone = "#2E8B7A" if ok else "#C45B7A"
    content = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{html.escape(title)}</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f6f8;margin:0;padding:32px">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 8px 24px rgba(0,0,0,.08)">
    <h1 style="margin:0 0 12px;color:{tone};font-size:22px">{html.escape(title)}</h1>
    <p style="margin:0;color:#333;line-height:1.5">{html.escape(body)}</p>
  </div>
</body></html>"""
    return HTMLResponse(content=content, status_code=200 if ok else 400)


@router.post("", status_code=201)
def create_referral(body: ReferralCreate, db: Session = Depends(get_db)) -> dict:
    referring = _require_doctor(db, body.from_doctor_key)
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
        status="pending_patient_consent",
        urgency=body.urgency,
        reason=body.reason.strip(),
        created_at=now,
        updated_at=now,
    )
    db.add(referral)
    db.flush()
    raw_token = _issue_consent_token(db, referral.referral_key)
    approve_url, decline_url = _consent_links(raw_token)
    _insert_message(
        db,
        referral.referral_key,
        body.from_doctor_key,
        f"Referral created ({body.urgency}). Waiting for patient consent: {body.reason.strip()}",
    )
    try:
        email = _send_consent_email(
            referring=referring,
            recipient=recipient,
            patient=patient,
            reason=body.reason.strip(),
            urgency=body.urgency,
            raw_token=raw_token,
        )
    except HTTPException as exc:
        email = {
            "status": "failed",
            "detail": str(exc.detail),
            "approve_url": approve_url,
            "decline_url": decline_url,
        }
    db.commit()
    db.refresh(referral)
    return {
        "referral": _referral_summary(db, referral, body.from_doctor_key),
        "receiving_doctor": clinic.doctor_payload(recipient),
        "messages": _messages(db, referral.referral_key),
        "email": email,
        "consent_pending": True,
        "consent": {"approve_url": approve_url, "decline_url": decline_url},
    }


@router.get("/consent", response_class=HTMLResponse)
def patient_consent(
    token: str = Query(..., min_length=16, max_length=200),
    decision: Literal["approve", "decline"] = Query(...),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    token_hash = _hash_token(token.strip())
    row = db.scalar(select(ReferralConsentToken).where(ReferralConsentToken.token_hash == token_hash))
    if row is None:
        return _consent_result_page(
            title="Link not valid",
            body="This referral consent link is invalid or was typed incorrectly.",
            ok=False,
        )
    if row.used_at is not None:
        return _consent_result_page(
            title="Already used",
            body="This consent link was already used. Contact your clinic if you need a change.",
            ok=False,
        )
    if row.expires_at < _utc_now():
        return _consent_result_page(
            title="Link expired",
            body="This consent link has expired. Ask your clinician to send a new referral.",
            ok=False,
        )

    referral = _get_referral(db, row.referral_key)
    if referral.status != "pending_patient_consent":
        return _consent_result_page(
            title="Referral already decided",
            body=f"This referral is already marked as {referral.status.replace('_', ' ')}.",
            ok=False,
        )

    referring = _require_doctor(db, referral.from_doctor_key)
    specialist = _require_doctor(db, referral.to_doctor_key)
    patient = db.get(Patient, referral.patient_key)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient was not found.")

    now = _utc_now()
    row.used_at = now
    row.decision = decision
    referral.updated_at = now

    if decision == "approve":
        referral.status = "shared_with_specialist"
        handoff = clinic.build_handoff_summary(db, patient, referral.from_doctor_key)
        _insert_message(
            db,
            referral.referral_key,
            referral.from_doctor_key,
            "[status] Patient approved the referral. Handoff shared with the specialist.",
        )
        try:
            _send_specialist_handoff_email(
                referring=referring,
                recipient=specialist,
                patient=patient,
                reason=referral.reason,
                urgency=referral.urgency,
                handoff=handoff,
            )
        except HTTPException:
            pass
        alert = _notify_referring_doctor(
            db,
            referral=referral,
            patient=patient,
            specialist=specialist,
            decision="approve",
        )
        db.commit()
        _alert_after_commit(db, alert)
        return _consent_result_page(
            title="Referral approved",
            body=(
                f"Thank you. Your referral to {specialist.display_name} is approved. "
                "Your clinician has been notified and your care summary was shared with the specialist."
            ),
            ok=True,
        )

    referral.status = "patient_declined"
    referral.outcome = "Patient declined referral consent"
    _insert_message(
        db,
        referral.referral_key,
        referral.from_doctor_key,
        "[status] Patient declined the referral.",
    )
    alert = _notify_referring_doctor(
        db,
        referral=referral,
        patient=patient,
        specialist=specialist,
        decision="decline",
    )
    db.commit()
    _alert_after_commit(db, alert)
    return _consent_result_page(
        title="Referral declined",
        body=(
            f"You declined the referral to {specialist.display_name}. "
            "Your clinician has been notified. No medical history was shared with the specialist."
        ),
        ok=True,
    )


@router.get("")
def list_referrals(
    doctor: str = Query(...),
    direction: Literal["in", "out"] | None = None,
    peer: str | None = Query(None, alias="with"),
    db: Session = Depends(get_db),
) -> list[dict]:
    _require_doctor(db, doctor)
    if peer:
        _require_doctor(db, peer)
    if direction == "in":
        query = select(ReferralRequest).where(ReferralRequest.to_doctor_key == doctor)
    elif direction == "out":
        query = select(ReferralRequest).where(ReferralRequest.from_doctor_key == doctor)
    else:
        query = select(ReferralRequest).where(
            or_(ReferralRequest.from_doctor_key == doctor, ReferralRequest.to_doctor_key == doctor)
        )
    if peer:
        query = query.where(
            or_(ReferralRequest.from_doctor_key == peer, ReferralRequest.to_doctor_key == peer)
        )
    rows = db.scalars(
        query.order_by(ReferralRequest.updated_at.desc(), ReferralRequest.referral_key)
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
