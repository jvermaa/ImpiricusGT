import json
import os
import smtplib
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from clinic import _panel_patient, build_handoff_summary
from database import get_db
from gemini_client import generate_text

router = APIRouter()


class PromptEmail(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)


def _pdf(lines: list[str]) -> bytes:
    commands = ["BT", "/F1 11 Tf", "50 780 Td", "14 TL"]
    for line in lines[:48]:
        safe = "".join(ch if 32 <= ord(ch) < 127 else " " for ch in line)[:92]
        safe = safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"({safe}) Tj")
        commands.append("T*")
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1")
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        f"4 0 obj << /Length {len(stream)} >> stream\n".encode("latin-1")
        + stream
        + b"\nendstream endobj\n",
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    chunks = [b"%PDF-1.4\n"]
    offsets = [0]
    for obj in objects:
        offsets.append(sum(len(chunk) for chunk in chunks))
        chunks.append(obj)
    xref = sum(len(chunk) for chunk in chunks)
    table = [f"xref\n0 {len(offsets)}\n", "0000000000 65535 f \n"]
    table.extend(f"{offset:010d} 00000 n \n" for offset in offsets[1:])
    table.append(f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF")
    chunks.append("".join(table).encode("latin-1"))
    return b"".join(chunks)


def _send_email(subject: str, body: str, intended: str) -> dict:
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USERNAME", "")
    password = os.getenv("SMTP_PASSWORD", "").replace(" ", "")
    sender = os.getenv("SMTP_FROM", username)
    redirect = os.getenv("EMAIL_REDIRECT_TO", "").strip()
    recipient = redirect or intended
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        f"Intended recipient: {intended}\n\n{body}" if redirect and redirect != intended else body
    )
    if os.getenv("EMAIL_SENDING_ENABLED", "").lower() != "true":
        return {"status": "sent", "detail": "simulated", "recipient": recipient}
    if not username or not password:
        raise HTTPException(status_code=503, detail="Email is not configured.")
    try:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(username, password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(status_code=502, detail="Email could not be sent.") from exc
    return {"status": "sent", "detail": "smtp", "recipient": recipient}


def _plain(value) -> str:
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(", ".join(str(piece) for piece in item.values() if piece))
            else:
                parts.append(str(item))
        return "; ".join(part for part in parts if part) or "None recorded"
    text = str(value or "").strip()
    return text or "None recorded"


@router.post("/patients/{patient_key}/prompt-email")
def prompt_email(
    patient_key: str,
    body: PromptEmail,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = _panel_patient(db, patient_key, doctor)
    intended = os.getenv("EMAIL_REDIRECT_TO", "").strip() or os.getenv("SMTP_FROM", "").strip()
    if not intended:
        raise HTTPException(status_code=409, detail="No email destination is configured.")
    generated = generate_text(
        "Write a short patient email from the clinician's instruction. "
        "Return JSON with keys subject and body. Plain language. "
        "Do not invent a diagnosis, medication, dose, or lab value. "
        f"Instruction: {body.prompt.strip()}"
    )
    subject = "Message from your clinic"
    text = body.prompt.strip()
    source = "prompt"
    if generated:
        try:
            start = generated.find("{")
            end = generated.rfind("}")
            parsed = json.loads(generated[start : end + 1])
            subject = str(parsed.get("subject") or subject)[:120]
            text = str(parsed.get("body") or text).strip() or text
            source = "gemini"
        except (json.JSONDecodeError, ValueError):
            text = generated.strip() or text
            source = "gemini"
    delivery = _send_email(subject, text, intended)
    return {
        "patient_key": patient.patient_key,
        "subject": subject,
        "body": text,
        "source": source,
        **delivery,
    }


@router.get("/patients/{patient_key}/record.pdf")
def record_pdf(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> Response:
    patient = _panel_patient(db, patient_key, doctor)
    summary = build_handoff_summary(db, patient, doctor)
    facts = [
        f"Patient: {summary['patient_display_label']} (Age {summary['age']})",
        f"Symptoms: {_plain(summary['symptoms'])}"[:400],
        f"Diagnoses: {_plain(summary['diagnoses'])}"[:400],
        f"Allergies: {_plain(summary['allergies'])}"[:300],
        f"Prescriptions: {_plain(summary['active_prescriptions'])}"[:400],
        f"Labs: {_plain(summary['labs'])}"[:300],
        f"Visits: {_plain(summary['encounters'])}"[:400],
    ]
    narrative = generate_text(
        "Write a one-paragraph medical handoff using only these recorded facts. "
        "Do not add diagnoses, medicines, or results that are not listed. "
        + " ".join(facts)
    )
    lines = ["Medical record", ""]
    if narrative:
        lines.extend(_wrap(narrative))
        lines.append("")
    for fact in facts:
        lines.extend(_wrap(fact))
    pdf = _pdf(lines)
    filename = f"{patient.patient_key}-record.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _wrap(text: str) -> list[str]:
    words = " ".join(text.split())
    lines: list[str] = []
    current = ""
    for word in words.split(" "):
        trial = word if not current else f"{current} {word}"
        if len(trial) > 90:
            if current:
                lines.append(current)
            current = word[:90]
        else:
            current = trial
    if current:
        lines.append(current)
    return lines or [""]
