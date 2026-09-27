"""Expo Push Service helpers for doctor device alerts."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import DoctorPushToken

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def _env_tokens() -> list[str]:
    raw = os.getenv("EXPO_PUSH_TOKEN", "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def list_tokens_for_doctor(db: Session, doctor_key: str) -> list[str]:
    rows = db.scalars(
        select(DoctorPushToken)
        .where(DoctorPushToken.doctor_key == doctor_key)
        .order_by(DoctorPushToken.updated_at.desc())
    ).all()
    tokens = [row.token for row in rows]
    for token in _env_tokens():
        if token not in tokens:
            tokens.append(token)
    return tokens


def upsert_push_token(db: Session, *, doctor_key: str, token: str) -> DoctorPushToken:
    cleaned = token.strip()
    existing = db.scalar(select(DoctorPushToken).where(DoctorPushToken.token == cleaned))
    now = datetime.utcnow()
    if existing is None:
        row = DoctorPushToken(
            token=cleaned,
            doctor_key=doctor_key,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        existing.doctor_key = doctor_key
        existing.updated_at = now
        row = existing
    db.commit()
    db.refresh(row)
    return row


def send_expo_push(
    *,
    tokens: list[str],
    title: str,
    body: str,
    data: dict | None = None,
) -> dict:
    unique = [token for token in dict.fromkeys(tokens) if token.startswith("ExponentPushToken")]
    if not unique:
        return {"delivered": False, "mode": "none", "detail": "No Expo push tokens registered."}

    messages = [
        {
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": data or {},
        }
        for token in unique
    ]
    request = urllib.request.Request(
        EXPO_PUSH_URL,
        data=json.dumps(messages).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return {"delivered": False, "mode": "remote", "detail": detail or str(exc)}
    except urllib.error.URLError as exc:
        return {"delivered": False, "mode": "remote", "detail": str(exc.reason)}

    return {
        "delivered": True,
        "mode": "remote",
        "detail": f"Sent to {len(unique)} device(s).",
        "tickets": payload.get("data"),
    }


def notify_doctor_devices(
    db: Session,
    *,
    doctor_key: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> dict:
    tokens = list_tokens_for_doctor(db, doctor_key)
    return send_expo_push(tokens=tokens, title=title, body=body, data=data)
