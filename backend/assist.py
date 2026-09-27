import json
import os
import smtplib
import time
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from clinic import _panel_patient, build_handoff_summary
from database import get_db
from gemini_client import generate_text

router = APIRouter()
_PDF_CACHE_TTL_SECONDS = 15 * 60
_record_pdf_cache: dict[str, dict[str, object]] = {}


class PromptEmail(BaseModel):
    prompt: str = Field(min_length=1, max_length=500)


def _sanitize_pdf_text(value: str, limit: int = 700) -> str:
    compact = " ".join(str(value or "").split())
    safe = "".join(ch if 32 <= ord(ch) < 127 else " " for ch in compact)
    safe = " ".join(safe.split())
    return safe[:limit]


def _escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _pdf_text(
    text: str,
    x: float,
    y: float,
    *,
    font: str = "F1",
    size: float = 11,
    color: tuple[float, float, float] = (0.13, 0.15, 0.2),
) -> str:
    safe = _escape_pdf_text(_sanitize_pdf_text(text) or " ")
    r, g, b = color
    return f"BT /{font} {size:.1f} Tf {r:.3f} {g:.3f} {b:.3f} rg {x:.1f} {y:.1f} Td ({safe}) Tj ET"


def _wrap_for_width(text: str, width: float, font_size: float) -> list[str]:
    safe = _sanitize_pdf_text(text, limit=1600)
    if not safe:
        return [""]
    max_chars = max(24, int(width / max(font_size * 0.54, 1)))
    words = safe.split(" ")
    lines: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else f"{current} {word}"
        if len(trial) <= max_chars:
            current = trial
            continue
        if current:
            lines.append(current)
        if len(word) > max_chars:
            lines.append(word[:max_chars])
            current = word[max_chars:]
        else:
            current = word
    if current:
        lines.append(current)
    return lines or [safe[:max_chars]]


def _pdf(pages: list[list[str]]) -> bytes:
    streams = [("\n".join(commands)).encode("latin-1", errors="ignore") for commands in pages if commands]
    if not streams:
        streams = [b""]
    page_count = len(streams)
    regular_font_obj = 3 + page_count * 2
    bold_font_obj = regular_font_obj + 1
    kids = " ".join(f"{3 + index * 2} 0 R" for index in range(page_count))
    objects: list[bytes] = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        f"2 0 obj << /Type /Pages /Kids [{kids}] /Count {page_count} >> endobj\n".encode("latin-1"),
    ]
    for index, stream in enumerate(streams):
        page_obj = 3 + index * 2
        content_obj = page_obj + 1
        page = (
            f"{page_obj} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {content_obj} 0 R /Resources << /Font << "
            f"/F1 {regular_font_obj} 0 R /F2 {bold_font_obj} 0 R >> >> >> endobj\n"
        ).encode("latin-1")
        content = (
            f"{content_obj} 0 obj << /Length {len(stream)} >> stream\n".encode("latin-1")
            + stream
            + b"\nendstream endobj\n"
        )
        objects.extend([page, content])
    objects.extend(
        [
            f"{regular_font_obj} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n".encode(
                "latin-1"
            ),
            f"{bold_font_obj} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n".encode(
                "latin-1"
            ),
        ]
    )
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


def _send_email(
    subject: str,
    body: str,
    intended: str,
    attachments: list[dict[str, str | bytes]] | None = None,
) -> dict:
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
    for attachment in attachments or []:
        content = attachment.get("content")
        if not isinstance(content, bytes):
            continue
        filename = str(attachment.get("filename") or "attachment.bin")
        maintype = str(attachment.get("maintype") or "application")
        subtype = str(attachment.get("subtype") or "octet-stream")
        message.add_attachment(
            content,
            maintype=maintype,
            subtype=subtype,
            filename=filename,
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


def _mock_prescription_label(summary: dict) -> str:
    active = summary.get("active_prescriptions")
    if isinstance(active, list) and active:
        chunks: list[str] = []
        for row in active[:3]:
            if not isinstance(row, dict):
                continue
            generic = str(row.get("generic_medication") or "").strip()
            strength = str(row.get("strength") or "").strip()
            status = str(row.get("status") or "").strip()
            medication = " ".join(part for part in [generic, strength] if part).strip() or "Unnamed medication"
            chunks.append(f"{medication} ({status})" if status else medication)
        if chunks:
            return "; ".join(chunks)
    current = str(summary.get("current_medications") or "").strip()
    if current:
        return current
    return "Continue current clinician-approved regimen."


def _fallback_visit_summary(encounters: list[dict]) -> str:
    if not encounters:
        return "- No past visits recorded."
    lines: list[str] = []
    for row in encounters[:5]:
        if not isinstance(row, dict):
            continue
        date = str(row.get("visit_date") or "Unknown date")
        diagnosis = str(row.get("diagnosis") or "Diagnosis not listed")
        note = str(row.get("summary") or "No visit notes recorded")
        lines.append(f"- {date}: {diagnosis}. {note}")
    return "\n".join(lines) if lines else "- No past visits recorded."


def _summarize_past_visits(encounters: list[dict]) -> tuple[str, str]:
    if not encounters:
        return "- No past visits recorded.", "fallback"
    facts = [
        {
            "visit_date": row.get("visit_date"),
            "diagnosis": row.get("diagnosis"),
            "summary": row.get("summary"),
            "symptoms": row.get("symptoms"),
            "current_medications": row.get("current_medications"),
            "lab_results": row.get("lab_results"),
        }
        for row in encounters[:8]
        if isinstance(row, dict)
    ]
    generated = generate_text(
        "Summarize these past clinic visits for a medical-record PDF. "
        "Return 4 to 6 concise bullet points as plain text. "
        "Use only the provided details and do not invent any diagnosis, medicine, dosage, or lab value.\n"
        f"VISITS_JSON: {json.dumps(facts, ensure_ascii=True)}"
    )
    if generated:
        cleaned = generated.strip()
        if cleaned:
            return cleaned, "gemini"
    return _fallback_visit_summary(encounters), "fallback"


def _visit_summary_points(visits_summary: str) -> list[str]:
    points: list[str] = []
    for line in visits_summary.splitlines():
        cleaned = _sanitize_pdf_text(line, limit=420).strip()
        if not cleaned:
            continue
        while cleaned[:1] in {"-", "*"}:
            cleaned = cleaned[1:].strip()
        if cleaned:
            points.append(cleaned)
    if points:
        return points[:10]
    fallback = _sanitize_pdf_text(visits_summary, limit=600)
    return [fallback] if fallback else ["No past visits recorded."]


def _record_pdf_pages(summary: dict, visits_summary: str, visits_source: str) -> list[list[str]]:
    page_width = 612.0
    page_height = 792.0
    margin = 40.0
    content_width = page_width - margin * 2
    header_height = 66.0
    footer_y = 24.0
    body_bottom = 48.0
    body_y = 0.0
    pages: list[list[str]] = []
    commands: list[str] = []
    page_number = 0
    generated_on = time.strftime("%b %d, %Y %I:%M %p")
    patient_name = _sanitize_pdf_text(str(summary.get("patient_display_label") or "Unknown patient"), limit=80)
    patient_age = _sanitize_pdf_text(str(summary.get("age") or "N/A"), limit=12)
    patient_sex = _sanitize_pdf_text(str(summary.get("sex_for_clinical_context") or "Unknown"), limit=24)
    patient_key = _sanitize_pdf_text(str(summary.get("patient_key") or "N/A"), limit=24)
    visit_points = _visit_summary_points(visits_summary)
    visit_count = summary.get("encounters")
    encounter_count = len(visit_count) if isinstance(visit_count, list) else 0

    snapshot_rows = [
        ("Primary diagnosis", _plain(summary.get("diagnoses"))),
        ("Current symptoms", _plain(summary.get("symptoms"))),
        ("Current medications", _plain(summary.get("current_medications"))),
        ("Relevant medical history", _plain(summary.get("relevant_medical_history"))),
        ("Family medical history", _plain(summary.get("family_medical_history"))),
        ("Allergies", _plain(summary.get("allergies"))),
        ("Labs", _plain(summary.get("labs"))),
        (
            "Risk/context",
            (
                f"Alcohol: {_plain(summary.get('alcohol_use'))}; "
                f"Smoking: {_plain(summary.get('smoking_status'))}; "
                f"Pregnancy: {_plain(summary.get('pregnancy_status'))}; "
                f"Immune: {_plain(summary.get('immune_status'))}"
            ),
        ),
    ]

    prescription_points = [
        chunk.strip()
        for chunk in _sanitize_pdf_text(_mock_prescription_label(summary), limit=700).split(";")
        if chunk.strip()
    ]
    if not prescription_points:
        prescription_points = ["Continue current clinician-approved regimen."]

    def new_page(*, include_card: bool) -> None:
        nonlocal commands, body_y, page_number
        commands = []
        pages.append(commands)
        page_number += 1
        commands.extend(
            [
                "1 1 1 rg",
                f"0 0 {page_width:.1f} {page_height:.1f} re f",
                "0.46 0.37 0.93 rg",
                f"0 {page_height - header_height:.1f} {page_width:.1f} {header_height:.1f} re f",
                "0.83 0.78 0.98 rg",
                f"0 {page_height - header_height:.1f} {page_width:.1f} 1 re f",
                "0.86 0.88 0.93 RG",
                f"{margin:.1f} {footer_y + 8:.1f} {page_width - margin * 2:.1f} 0 re S",
            ]
        )
        commands.append(
            _pdf_text(
                "Impiricus Summarized Medical Record",
                margin,
                page_height - 33,
                font="F2",
                size=17,
                color=(1, 1, 1),
            )
        )
        commands.append(
            _pdf_text(
                f"Generated {generated_on}  |  Past-visit summary source: {visits_source.upper()}",
                margin,
                page_height - 48,
                font="F1",
                size=9.5,
                color=(0.95, 0.94, 1.0),
            )
        )
        commands.append(
            _pdf_text(
                f"Confidential clinical demo  |  Page {page_number}",
                margin,
                footer_y,
                font="F1",
                size=8.5,
                color=(0.42, 0.45, 0.52),
            )
        )
        body_y = page_height - header_height - 18
        if include_card:
            card_height = 74.0
            card_y = body_y - card_height
            commands.extend(
                [
                    "0.95 0.96 1.00 rg",
                    f"{margin:.1f} {card_y:.1f} {content_width:.1f} {card_height:.1f} re f",
                    "0.81 0.84 0.95 RG",
                    f"{margin:.1f} {card_y:.1f} {content_width:.1f} {card_height:.1f} re S",
                ]
            )
            commands.append(_pdf_text(patient_name, margin + 14, card_y + 49, font="F2", size=15))
            commands.append(
                _pdf_text(
                    f"Patient ID: {patient_key}  |  Age: {patient_age}  |  Sex: {patient_sex}",
                    margin + 14,
                    card_y + 32,
                    size=10.5,
                    color=(0.22, 0.25, 0.35),
                )
            )
            commands.append(
                _pdf_text(
                    "Created to support referrals and specialist handoffs.",
                    margin + 14,
                    card_y + 17,
                    size=9.5,
                    color=(0.35, 0.37, 0.44),
                )
            )
            body_y = card_y - 14

    def ensure_space(required: float) -> None:
        nonlocal body_y
        if body_y - required >= body_bottom:
            return
        new_page(include_card=False)

    def section_header(title: str) -> None:
        nonlocal body_y
        ensure_space(30)
        bar_height = 20.0
        commands.extend(
            [
                "0.90 0.88 0.99 rg",
                f"{margin:.1f} {body_y - bar_height + 5:.1f} {content_width:.1f} {bar_height:.1f} re f",
            ]
        )
        commands.append(_pdf_text(title, margin + 10, body_y - 10, font="F2", size=11.5, color=(0.29, 0.23, 0.58)))
        body_y -= 24

    def paragraph(text: str, *, size: float = 10.7, indent: float = 0.0, muted: bool = False) -> None:
        nonlocal body_y
        lines = _wrap_for_width(text, content_width - indent, size)
        tone = (0.17, 0.19, 0.24) if not muted else (0.37, 0.39, 0.46)
        line_height = size + 3.4
        for line in lines:
            ensure_space(line_height)
            commands.append(_pdf_text(line, margin + indent, body_y, size=size, color=tone))
            body_y -= line_height

    def bullet(text: str) -> None:
        nonlocal body_y
        lines = _wrap_for_width(text, content_width - 20, 10.6)
        for index, line in enumerate(lines):
            ensure_space(14.0)
            prefix = "- " if index == 0 else "  "
            commands.append(_pdf_text(f"{prefix}{line}", margin + 8, body_y, size=10.6))
            body_y -= 14.0

    new_page(include_card=True)

    section_header("Clinical Snapshot")
    for label, value in snapshot_rows:
        paragraph(f"{label}: {_sanitize_pdf_text(value, limit=900)}")
    body_y -= 4

    section_header("Mock Prescription")
    paragraph("Medication summary prepared for referral handoff.", size=10.0, muted=True)
    for item in prescription_points[:8]:
        bullet(item)
    body_y -= 4

    section_header("Past Visit Highlights")
    paragraph(
        f"Summarized from {encounter_count} recorded visit(s).",
        size=10.0,
        muted=True,
    )
    for point in visit_points:
        bullet(point)
    body_y -= 4

    section_header("Care Coordination Note")
    paragraph(
        "This PDF is generated from recorded chart data and AI summarization for communication support. "
        "Clinical decisions should always be validated by the treating clinician.",
        size=10.0,
        muted=True,
    )
    return pages


def _build_record_pdf(summary: dict) -> tuple[bytes, str]:
    encounters = summary.get("encounters")
    encounter_rows = encounters if isinstance(encounters, list) else []
    visits_summary, visits_source = _summarize_past_visits(encounter_rows)
    pages = _record_pdf_pages(summary, visits_summary, visits_source)
    return _pdf(pages), visits_source


def _cache_key(patient_key: str, doctor: str) -> str:
    return f"{doctor}:{patient_key}"


def _load_cached_pdf(patient_key: str, doctor: str) -> tuple[bytes, str] | None:
    cache = _record_pdf_cache.get(_cache_key(patient_key, doctor))
    if not cache:
        return None
    created_at = cache.get("created_at")
    if not isinstance(created_at, (int, float)):
        return None
    age_seconds = int(time.time() - created_at)
    if age_seconds > _PDF_CACHE_TTL_SECONDS:
        _record_pdf_cache.pop(_cache_key(patient_key, doctor), None)
        return None
    payload = cache.get("pdf")
    source = cache.get("source")
    if isinstance(payload, bytes) and isinstance(source, str):
        return payload, source
    return None


def _store_cached_pdf(patient_key: str, doctor: str, pdf: bytes, source: str) -> None:
    _record_pdf_cache[_cache_key(patient_key, doctor)] = {
        "pdf": pdf,
        "source": source,
        "created_at": time.time(),
    }


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
    cached = _load_cached_pdf(patient.patient_key, doctor)
    if cached:
        pdf, _ = cached
    else:
        summary = build_handoff_summary(db, patient, doctor)
        pdf, source = _build_record_pdf(summary)
        _store_cached_pdf(patient.patient_key, doctor, pdf, source)
    filename = f"{patient.patient_key}-record.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/patients/{patient_key}/record.pdf/prepare")
def prepare_record_pdf(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = _panel_patient(db, patient_key, doctor)
    summary = build_handoff_summary(db, patient, doctor)
    pdf, source = _build_record_pdf(summary)
    _store_cached_pdf(patient.patient_key, doctor, pdf, source)
    encounters = summary.get("encounters")
    visit_count = len(encounters) if isinstance(encounters, list) else 0
    return {
        "patient_key": patient.patient_key,
        "status": "ready",
        "visit_summary_source": source,
        "visit_count": visit_count,
    }


@router.post("/patients/{patient_key}/record.pdf/send")
def send_record_pdf(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = _panel_patient(db, patient_key, doctor)
    intended = (patient.email_address or "").strip()
    if not intended:
        raise HTTPException(status_code=409, detail="Patient email is not available.")
    cached = _load_cached_pdf(patient.patient_key, doctor)
    if cached:
        pdf, source = cached
    else:
        summary = build_handoff_summary(db, patient, doctor)
        pdf, source = _build_record_pdf(summary)
        _store_cached_pdf(patient.patient_key, doctor, pdf, source)
    filename = f"{patient.patient_key}-record.pdf"
    subject = "Your summarized medical record PDF"
    body = (
        "Attached is your summarized medical record generated by your clinician. "
        "Please review it with your care team for medical decisions."
    )
    delivery = _send_email(
        subject,
        body,
        intended,
        attachments=[
            {
                "filename": filename,
                "maintype": "application",
                "subtype": "pdf",
                "content": pdf,
            }
        ],
    )
    return {
        "patient_key": patient.patient_key,
        "source": source,
        "subject": subject,
        "filename": filename,
        **delivery,
    }


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
