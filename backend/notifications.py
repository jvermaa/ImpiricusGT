"""In-app doctor notification inbox (DB-backed)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from keys import next_key
from models import Doctor, DoctorNotification

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationCreate(BaseModel):
    doctor_key: str
    type: str
    title: str
    sender: str
    brand: str
    preview: str
    body: str
    link_url: str | None = None
    link_button_label: str | None = None
    find_suitable_patients: bool = False
    opens_chat: bool = True
    unread_count: int = 1
    actions: list[dict] = Field(default_factory=list)
    info_card: dict = Field(default_factory=dict)
    messages: list[dict] = Field(default_factory=list)
    patient_link: dict | None = None
    campaign_chips: list[dict] = Field(default_factory=list)
    reply_prompt: str | None = None


class NotificationMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    sender_id: str = Field(default="me", pattern="^(me|desk)$")
    sender_name: str | None = None
    sender_role: str | None = None


def _require_doctor(db: Session, doctor_key: str) -> Doctor:
    doctor = db.get(Doctor, doctor_key)
    if doctor is None:
        raise HTTPException(status_code=404, detail=f"Doctor {doctor_key} was not found.")
    return doctor


def _payload(row: DoctorNotification) -> dict:
    try:
        decoded = json.loads(row.payload_json or "{}")
    except (TypeError, ValueError):
        decoded = {}
    return decoded if isinstance(decoded, dict) else {}


def _time_ago(created_at: datetime, now: datetime | None = None) -> str:
    now = now or datetime.utcnow()
    created = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
    seconds = max(0, int((now - created).total_seconds()))
    if seconds < 60:
        return "Just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 48:
        return f"{hours}h ago"
    days = hours // 24
    if days < 14:
        return f"{days}d ago"
    weeks = days // 7
    return f"{weeks}w ago"


def notification_payload(row: DoctorNotification) -> dict:
    extra = _payload(row)
    opens_chat = row.opens_chat
    if row.find_suitable_patients:
        opens_chat = False
    return {
        "id": row.notification_key,
        "type": row.type,
        "title": row.title,
        "sender": row.sender,
        "brand": row.brand,
        "preview": row.preview,
        "body": row.body,
        "actions": extra.get("actions") or [],
        "threadId": row.thread_id,
        "unread": row.unread_count,
        "timeAgo": _time_ago(row.created_at),
        "infoCard": extra.get("infoCard")
        or {"title": row.title, "sections": []},
        "messages": extra.get("messages") or [],
        "patientLink": extra.get("patientLink"),
        "findSuitablePatients": row.find_suitable_patients,
        "opensChat": opens_chat,
        "campaignChips": extra.get("campaignChips") or [],
        "linkUrl": row.link_url,
        "linkButtonLabel": row.link_button_label,
        "replyPrompt": extra.get("replyPrompt"),
        "createdAt": row.created_at.isoformat(),
        "readAt": row.read_at.isoformat() if row.read_at else None,
    }


def _get_owned(db: Session, notification_key: str, doctor_key: str) -> DoctorNotification:
    _require_doctor(db, doctor_key)
    row = db.get(DoctorNotification, notification_key)
    if row is None or row.doctor_key != doctor_key:
        raise HTTPException(status_code=404, detail="Notification was not found for this doctor.")
    return row


@router.get("")
def list_notifications(doctor: str = Query(...), db: Session = Depends(get_db)) -> list[dict]:
    _require_doctor(db, doctor)
    rows = db.scalars(
        select(DoctorNotification)
        .where(DoctorNotification.doctor_key == doctor)
        .order_by(DoctorNotification.created_at.desc(), DoctorNotification.notification_key.desc())
    ).all()
    return [notification_payload(row) for row in rows]


@router.get("/{notification_key}")
def get_notification(
    notification_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    return notification_payload(_get_owned(db, notification_key, doctor))


@router.post("", status_code=201)
def create_notification(body: NotificationCreate, db: Session = Depends(get_db)) -> dict:
    _require_doctor(db, body.doctor_key)
    key = next_key(db, DoctorNotification.notification_key, "N")
    payload = {
        "actions": body.actions,
        "infoCard": body.info_card,
        "messages": body.messages,
        "patientLink": body.patient_link,
        "campaignChips": body.campaign_chips,
        "replyPrompt": body.reply_prompt,
    }
    row = DoctorNotification(
        notification_key=key,
        doctor_key=body.doctor_key,
        type=body.type,
        title=body.title,
        sender=body.sender,
        brand=body.brand,
        preview=body.preview,
        body=body.body,
        thread_id=f"thread-{key.lower()}",
        link_url=body.link_url,
        link_button_label=body.link_button_label,
        find_suitable_patients=body.find_suitable_patients,
        opens_chat=False if body.find_suitable_patients else body.opens_chat,
        unread_count=max(0, body.unread_count),
        payload_json=json.dumps(payload),
        created_at=datetime.utcnow(),
        read_at=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return notification_payload(row)


@router.post("/{notification_key}/read")
def mark_read(
    notification_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    row = _get_owned(db, notification_key, doctor)
    row.unread_count = 0
    row.read_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return notification_payload(row)


@router.post("/{notification_key}/messages", status_code=201)
def append_message(
    notification_key: str,
    body: NotificationMessageCreate,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    row = _get_owned(db, notification_key, doctor)
    extra = _payload(row)
    messages = list(extra.get("messages") or [])
    message = {
        "id": f"m{len(messages) + 1}-{int(datetime.now(timezone.utc).timestamp())}",
        "senderId": body.sender_id,
        "senderName": body.sender_name,
        "senderRole": body.sender_role,
        "text": body.text.strip(),
        "timestamp": "Now",
    }
    messages.append(message)
    extra["messages"] = messages
    row.payload_json = json.dumps(extra)
    db.commit()
    db.refresh(row)
    return {"notification": notification_payload(row), "message": message}
