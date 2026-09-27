"""Clinician-reviewed patient emails. Gemini drafts them; SMTP sends only after approval."""

import json
import os
import re
import smtplib
from datetime import datetime
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

import clinic
from database import get_db
from gemini_client import generate_text
from models import Diagnosis, Followup, Patient, PatientEmail, Prescription

router = APIRouter()

PURPOSES = (
    "follow_up_reminder",
    "appointment_reminder",
    "medication_check_in",
    "education_resources",
)
TEMPLATES = {
    "follow_up_reminder": (
        "Please check your patient portal",
        "Hello,\n\nYour care team has a follow-up for you. Please sign in to the patient portal or contact the office. This note does not include medical details.\n\n{doctor}",
    ),
    "appointment_reminder": (
        "Please contact the office about your visit",
        "Hello,\n\nYour care team is asking you to confirm your next visit. Please sign in to the patient portal or contact the office. This note does not include medical details.\n\n{doctor}",
    ),
    "medication_check_in": (
        "Please check in with your care team",
        "Hello,\n\nYour care team would like a check-in. Please sign in to the patient portal or contact the office. This note does not include medical details.\n\n{doctor}",
    ),
    "education_resources": (
        "Information is waiting in your portal",
        "Hello,\n\nYour care team left information for you in the patient portal. Please sign in or contact the office. This note does not include medical details.\n\n{doctor}",
    ),
}


class DraftBody(BaseModel):
    purpose: str
    tone: str = "warm"
    language: str | None = None


class EditBody(BaseModel):
    subject: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=4000)


def _safe_language(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    words = value.strip().split()
    blocked = {"ignore", "write", "email", "patient", "list", "diagnosis", "symptom", "send"}
    if not 1 <= len(words) <= 2:
        return fallback
    if not all(re.fullmatch(r"[A-Za-z]{2,20}", word) for word in words):
        return fallback
    if any(word.casefold() in blocked for word in words):
        return fallback
    return " ".join(words)


def _clinical_terms(db: Session, patient_key: str) -> list[str]:
    labels = db.scalars(select(Diagnosis.label).where(Diagnosis.patient_key == patient_key)).all()
    meds = db.scalars(
        select(Prescription.generic_medication).where(Prescription.patient_key == patient_key)
    ).all()
    return [term.strip() for term in [*labels, *meds] if term and len(term.strip()) >= 4]


def _contains_clinical(text: str, terms: list[str]) -> bool:
    lowered = text.casefold()
    return any(term.casefold() in lowered for term in terms)


def _valid_copy(subject: str, body: str, terms: list[str]) -> bool:
    if not subject or len(subject) > 80 or len(body.split()) > 150:
        return False
    if _contains_clinical(f"{subject}\n{body}", terms):
        return False
    return True


def _template(purpose: str, doctor_name: str) -> tuple[str, str]:
    subject, body = TEMPLATES[purpose]
    return subject, body.format(doctor=doctor_name)


def _parse_draft(raw: str | None) -> tuple[str, str] | None:
    if not raw:
        return None
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.removeprefix("json").strip()
    try:
        payload = json.loads(text)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    subject = str(payload.get("subject") or "").strip()
    body = str(payload.get("body") or "").strip()
    if not subject or not body:
        return None
    return subject, body


def _due_followup(db: Session, patient: Patient, doctor_key: str) -> Followup | None:
    year = datetime.utcnow().year
    rows = db.scalars(
        select(Followup)
        .where(
            Followup.patient_key == patient.patient_key,
            Followup.doctor_key == doctor_key,
            Followup.due_year <= year,
        )
        .order_by(Followup.due_year.desc())
    ).all()
    for row in rows:
        existing = db.scalar(
            select(PatientEmail.id).where(PatientEmail.followup_key == row.followup_key)
        )
        if existing is None:
            return row
    return None


def build_draft(
    db: Session,
    patient: Patient,
    doctor_name: str,
    doctor_key: str,
    purpose: str,
    tone: str,
    language: str | None,
) -> PatientEmail:
    if purpose not in PURPOSES:
        raise HTTPException(status_code=422, detail="That purpose is not supported.")
    if tone not in {"warm", "neutral"}:
        raise HTTPException(status_code=422, detail="Tone must be warm or neutral.")
    followup = _due_followup(db, patient, doctor_key) if purpose == "follow_up_reminder" else None
    spoken = _safe_language(language, patient.preferred_language)
    terms = _clinical_terms(db, patient.patient_key)
    prompt = (
        "Write a patient-portal email as JSON {\"subject\": \"...\", \"body\": \"...\"}. "
        "The body must tell the patient to sign in to the patient portal or contact the office. "
        "Do not include a diagnosis, drug name, dose, lab value, patient name, or email address. "
        "Plain text. Subject at most 80 characters. Body at most 150 words. "
        f"Purpose: {purpose}. Tone: {tone}. Language: {spoken}. "
        f"Clinician display name: {doctor_name}. "
        f"Follow-up due year: {followup.due_year if followup else 'not specified'}."
    )
    try:
        raw = generate_text(prompt)
    except Exception:
        raw = None
    parsed = _parse_draft(raw)
    generated_by = "fallback"
    subject, body = _template(purpose, doctor_name)
    if parsed and _valid_copy(parsed[0], parsed[1], terms):
        subject, body = parsed
        generated_by = "gemini"
    row = PatientEmail(
        patient_key=patient.patient_key,
        doctor_key=doctor_key,
        followup_key=followup.followup_key if followup else None,
        purpose=purpose,
        subject=subject,
        body=body,
        status="draft",
        created_at=datetime.utcnow(),
        approved_at=None,
        sent_at=None,
        error=None,
        generated_by=generated_by,
    )
    db.add(row)
    clinic._commit(db)
    db.refresh(row)
    return row


def _owned_email(db: Session, email_id: int, doctor_key: str) -> PatientEmail:
    clinic._require_doctor(db, doctor_key)
    row = db.get(PatientEmail, email_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Email draft was not found.")
    if row.doctor_key != doctor_key:
        raise HTTPException(status_code=403, detail="Only the drafting doctor can update this email.")
    clinic._panel_patient(db, row.patient_key, doctor_key)
    return row


def deliver(row: PatientEmail, intended_to: str) -> tuple[str, str | None]:
    enabled = os.getenv("EMAIL_SENDING_ENABLED", "false").strip().lower() == "true"
    if not enabled:
        return "sent", "simulated"
    redirect = os.getenv("EMAIL_REDIRECT_TO", "").strip()
    recipient = redirect or intended_to
    body = row.body
    if redirect:
        body = f"Intended recipient: {intended_to}\n\n{body}"
    message = EmailMessage()
    message["Subject"] = row.subject
    message["From"] = os.getenv("SMTP_FROM", "")
    message["To"] = recipient
    message.set_content(body)
    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT", "587") or "587")
    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "")
    if not host or not message["From"] or not recipient:
        return "failed", "SMTP is not configured."
    try:
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            smtp.starttls()
            if username:
                smtp.login(username, password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        return "failed", str(exc)
    return "sent", None


def _payload(row: PatientEmail) -> dict:
    return {
        "id": row.id,
        "patient_key": row.patient_key,
        "doctor_key": row.doctor_key,
        "followup_key": row.followup_key,
        "purpose": row.purpose,
        "subject": row.subject,
        "body": row.body,
        "status": row.status,
        "created_at": row.created_at.isoformat(),
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "sent_at": row.sent_at.isoformat() if row.sent_at else None,
        "error": row.error,
        "generated_by": row.generated_by,
        "redirected": bool(os.getenv("EMAIL_REDIRECT_TO", "").strip()),
    }


@router.post("/patients/{patient_key}/emails/draft", status_code=201)
def draft_email(
    patient_key: str,
    body: DraftBody,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = clinic._panel_patient(db, patient_key, doctor)
    clinician = clinic._require_doctor(db, doctor)
    row = build_draft(db, patient, clinician.display_name, doctor, body.purpose, body.tone, body.language)
    return _payload(row)


@router.get("/patients/{patient_key}/emails")
def list_emails(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> list[dict]:
    clinic._panel_patient(db, patient_key, doctor)
    rows = db.scalars(
        select(PatientEmail)
        .where(PatientEmail.patient_key == patient_key, PatientEmail.doctor_key == doctor)
        .order_by(PatientEmail.created_at.desc())
    ).all()
    return [_payload(row) for row in rows]


@router.post("/emails/auto-draft", status_code=201)
def auto_draft(doctor: str = Query(...), db: Session = Depends(get_db)) -> list[dict]:
    clinician = clinic._require_doctor(db, doctor)
    year = datetime.utcnow().year
    followups = db.scalars(
        select(Followup).where(Followup.doctor_key == doctor, Followup.due_year <= year)
    ).all()
    created = []
    for followup in followups:
        existing = db.scalar(
            select(PatientEmail.id).where(PatientEmail.followup_key == followup.followup_key)
        )
        if existing is not None:
            continue
        patient = clinic._panel_patient(db, followup.patient_key, doctor)
        created.append(
            _payload(
                build_draft(
                    db,
                    patient,
                    clinician.display_name,
                    doctor,
                    "follow_up_reminder",
                    "neutral",
                    None,
                )
            )
        )
    return created


@router.patch("/emails/{email_id}")
def edit_email(
    email_id: int,
    body: EditBody,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    row = _owned_email(db, email_id, doctor)
    if row.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft can be edited.")
    terms = _clinical_terms(db, row.patient_key)
    if not _valid_copy(body.subject.strip(), body.body.strip(), terms):
        raise HTTPException(status_code=422, detail="The email must stay free of clinical details.")
    row.subject = body.subject.strip()
    row.body = body.body.strip()
    row.generated_by = "doctor"
    clinic._commit(db)
    db.refresh(row)
    return _payload(row)


@router.post("/emails/{email_id}/approve")
def approve_email(
    email_id: int,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    row = _owned_email(db, email_id, doctor)
    if row.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft can be approved.")
    row.status = "approved"
    row.approved_at = datetime.utcnow()
    clinic._commit(db)
    db.refresh(row)
    return _payload(row)


@router.post("/emails/{email_id}/send")
def send_email(
    email_id: int,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    row = _owned_email(db, email_id, doctor)
    if row.status != "approved" or row.approved_at is None:
        raise HTTPException(status_code=409, detail="Approve the email before it can be sent.")
    patient = db.get(Patient, row.patient_key)
    if patient is None or not patient.contact_email:
        raise HTTPException(status_code=422, detail="This patient has no contact email.")
    status, error = deliver(row, patient.contact_email)
    row.status = status
    row.error = error
    if status == "sent":
        row.sent_at = datetime.utcnow()
    clinic._commit(db)
    db.refresh(row)
    return _payload(row)
