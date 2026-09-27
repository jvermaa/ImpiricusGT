import asyncio
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import assist
import clinic
import notifications
import referrals
from database import Base, SessionLocal, engine, get_db
from models import Doctor

load_dotenv(Path(__file__).resolve().parent / ".env")

app = FastAPI(title="Impiricus HCP engagement API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(clinic.router)
app.include_router(referrals.router)
app.include_router(assist.router)
app.include_router(notifications.router)
Base.metadata.create_all(bind=engine)

WATCH_TOKENS = {
    "demo-hcp-1": "D002",
    "demo-hcp-2": "D003",
    "demo-hcp-3": "D004",
    "demo-hcp-4": "D007",
    "demo-hcp-5": "D008",
}
_subscribers: list[asyncio.Queue] = []
_sample_requests: dict[str, dict] = {}


class WatchConsult(BaseModel):
    token: str
    question: str = Field(min_length=1, max_length=500)


class WatchPass(BaseModel):
    token: str
    patient_key: str


class WatchVote(BaseModel):
    token: str
    choice: str


class SampleRequest(BaseModel):
    token: str
    catalog_id: str


def _doctor_for_token(token: str, db: Session) -> Doctor:
    doctor_key = WATCH_TOKENS.get(token)
    if doctor_key is None:
        raise HTTPException(status_code=401, detail="Unknown watch token.")
    doctor = db.get(Doctor, doctor_key)
    if doctor is None:
        raise HTTPException(status_code=404, detail=f"Watch token is not mapped to a loaded doctor ({doctor_key}).")
    return doctor


async def _publish(event: dict) -> None:
    for queue in list(_subscribers):
        await queue.put(event)


def _label_excerpt(question: str) -> str | None:
    path = Path(__file__).resolve().parent / "labels" / "chunks.jsonl"
    if not path.exists():
        return None
    words = {word.lower() for word in question.split() if len(word) > 3}
    best: tuple[int, str] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        chunk = json.loads(line)
        text = chunk.get("text", "")
        overlap = len(words & {word.lower().strip(".,") for word in text.split()})
        if overlap and (best is None or overlap > best[0]):
            citation = chunk.get("citation", "label")
            best = (overlap, f"{text} Source: {citation}")
    return best[1] if best else None


@app.post("/watch/consult")
async def watch_consult(body: WatchConsult, db: Session = Depends(get_db)) -> dict:
    doctor = _doctor_for_token(body.token, db)
    excerpt = _label_excerpt(body.question)
    if excerpt is None:
        answer = "No approved label text was retrieved. Route this question to Medical Information."
    else:
        answer = excerpt
    event = {
        "type": "watch_consult",
        "doctor_key": doctor.doctor_key,
        "answer": answer,
    }
    await _publish(event)
    return event


@app.post("/watch/patient-pass")
async def watch_patient_pass(body: WatchPass, db: Session = Depends(get_db)) -> dict:
    doctor = _doctor_for_token(body.token, db)
    event = {
        "type": "patient_pass",
        "doctor_key": doctor.doctor_key,
        "patient_key": body.patient_key,
    }
    await _publish(event)
    return event


@app.get("/watch/case/today")
def watch_case_today(token: str = Query(...), db: Session = Depends(get_db)) -> dict:
    doctor = _doctor_for_token(token, db)
    return {
        "case_id": "CASE-TODAY",
        "doctor_key": doctor.doctor_key,
        "prompt": "Synthetic case of the day. This poll does not assign a diagnosis.",
        "choices": ["Review with peer", "Park for clinic"],
    }


@app.post("/watch/case/{case_id}/vote")
async def watch_vote(case_id: str, body: WatchVote, db: Session = Depends(get_db)) -> dict:
    doctor = _doctor_for_token(body.token, db)
    event = {
        "type": "case_vote",
        "case_id": case_id,
        "doctor_key": doctor.doctor_key,
        "choice": body.choice,
    }
    await _publish(event)
    return event


@app.get("/watch/samples/catalog")
def sample_catalog(token: str = Query(...), db: Session = Depends(get_db)) -> dict:
    doctor = _doctor_for_token(token, db)
    return {
        "doctor_key": doctor.doctor_key,
        "items": [
            {
                "catalog_id": "SAMPLE-001",
                "label": "Clinic leave-behind request. A clinician signs before anything is released.",
            }
        ],
    }


@app.post("/watch/samples/request", status_code=201)
async def request_sample(body: SampleRequest, db: Session = Depends(get_db)) -> dict:
    doctor = _doctor_for_token(body.token, db)
    request_id = f"SR{len(_sample_requests) + 1:03d}"
    record = {
        "request_id": request_id,
        "doctor_key": doctor.doctor_key,
        "catalog_id": body.catalog_id,
        "status": "awaiting signature",
    }
    _sample_requests[request_id] = record
    await _publish({"type": "sample_request", **record})
    return record


@app.post("/samples/{request_id}/sign")
async def sign_sample(request_id: str, token: str = Query(...), db: Session = Depends(get_db)) -> dict:
    doctor = _doctor_for_token(token, db)
    record = _sample_requests.get(request_id)
    if record is None or record["doctor_key"] != doctor.doctor_key:
        raise HTTPException(status_code=404, detail="Sample request was not found for this doctor.")
    record["status"] = "signed"
    await _publish({"type": "sample_signed", **record})
    return record


@app.get("/events")
async def events(token: str = Query(...), db: Session = Depends(get_db)) -> StreamingResponse:
    _doctor_for_token(token, db)
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.append(queue)

    async def stream() -> AsyncIterator[str]:
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                event = await queue.get()
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            if queue in _subscribers:
                _subscribers.remove(queue)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/voice/incoming", response_class=PlainTextResponse)
def voice_incoming() -> str:
    wss = os.getenv("PUBLIC_VOICE_WSS_URL", "wss://localhost:8000/voice/ws")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response><Connect>"
        f'<ConversationRelay url="{wss}" />'
        "</Connect></Response>"
    )


@app.websocket("/voice/ws")
async def voice_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(
        {
            "type": "text",
            "token": (
                "Inbound clinician line. No outbound calls are placed from here. "
                "Questions without retrieved label text go to Medical Information."
            ),
        }
    )
    try:
        while True:
            message = await websocket.receive_text()
            excerpt = _label_excerpt(message)
            reply = excerpt or "No approved label text was retrieved. Route this question to Medical Information."
            await websocket.send_json({"type": "text", "token": reply})
    except Exception:
        await websocket.close()
