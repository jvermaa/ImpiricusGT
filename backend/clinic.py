import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from keys import next_key
from models import (
    Allergy,
    CaseMatch,
    ConsultMessage,
    ConsultThread,
    Diagnosis,
    Doctor,
    Encounter,
    Followup,
    Lab,
    Patient,
    Prescription,
    ReferralRequest,
)

router = APIRouter()

SPECIALTY_TITLES = {
    "Cardiology": "Cardiologist",
    "Dermatology": "Dermatologist",
    "Endocrinology": "Endocrinologist",
    "Gastroenterology": "Gastroenterologist",
    "Neurology": "Neurologist",
    "Primary Care": "Primary Care Physician",
    "Pulmonology": "Pulmonologist",
    "Rheumatology": "Rheumatologist",
}

SEX_LABELS = {
    "female": "Female",
    "male": "Male",
    "not recorded": "Not recorded",
}

SMOKING_LABELS = {
    "never": "Never smoker",
    "former": "Former smoker",
    "unknown": "Unknown",
}


class DoctorCreate(BaseModel):
    display_name: str
    credentials: str
    specialty: str
    subspecialty_focus: str
    practice_type: str
    state: str
    years_in_practice: int
    languages: list[str] = Field(default_factory=list)
    case_exchange_opt_in: bool = False
    accepts_peer_consults: bool = False
    patient_message_review_required: bool = True
    professional_email: str
    professional_phone: str | None = None
    license_number: str | None = None
    npi: str | None = None
    organization: str


class DiagnosisIn(BaseModel):
    label: str
    code_system: str = "ICD-10-CM"
    code: str
    status: str = "active"
    first_recorded_year: int


class PatientCreate(BaseModel):
    name: str
    age_group: str
    state: str
    sex_for_clinical_context: str
    preferred_language: str
    primary_doctor_key: str
    allergy_status: str = "none reported"
    symptoms: list[str] = Field(default_factory=list)
    tobacco_use: str = "unknown"
    surgery_history: str = "not recorded"
    family_history: str = "not recorded"
    pregnancy_status: str = "not recorded"
    portal_access: bool = False
    email_contact_available: bool = False
    messaging_preference: str = "unavailable"
    patient_education_language: str = "English"
    sharing_preference_for_peer_cases: str = "not documented"
    clinical_trial_outreach_preference: str = "not documented"
    diagnoses: list[DiagnosisIn] = Field(default_factory=list)


class ConsultOpen(BaseModel):
    model_config = ConfigDict(extra="forbid")

    peer_doctor_key: str


class ConsultMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=1000)


class DoctorSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accepts_peer_consults: bool | None = None
    case_exchange_opt_in: bool | None = None


class DoctorBioUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bio: str | None = None

    @field_validator("bio")
    @classmethod
    def plain_bio(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.replace("\r\n", "\n").strip()
        if "<" in cleaned or ">" in cleaned:
            raise ValueError("Bio must be plain text.")
        if len(cleaned) > 280:
            raise ValueError("Bio must be 280 characters or fewer.")
        return cleaned or None


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That record conflicts with an existing key or relationship.") from exc


def _initials(display_name: str) -> str:
    parts = [part for part in display_name.replace("Dr.", "").split() if part]
    return "".join(part[0] for part in parts[:2]).upper()


def _specialty_title(specialty: str) -> str:
    return SPECIALTY_TITLES.get(specialty, specialty)


def _age_years(age_group: str) -> int | None:
    piece = age_group.split("-")[0]
    if piece.isdigit():
        return int(piece) + 5
    return None


def doctor_payload(doctor: Doctor) -> dict:
    return {
        "doctor_key": doctor.doctor_key,
        "display_name": doctor.display_name,
        "initials": _initials(doctor.display_name),
        "specialty": doctor.specialty,
        "specialty_title": _specialty_title(doctor.specialty),
        "credentials": doctor.credentials,
        "subspecialty_focus": doctor.subspecialty_focus,
        "practice_type": doctor.practice_type,
        "state": doctor.state,
        "years_in_practice": doctor.years_in_practice,
        "languages": json.loads(doctor.languages_json),
        "organization": doctor.organization,
        "accepts_peer_consults": doctor.accepts_peer_consults,
        "case_exchange_opt_in": doctor.case_exchange_opt_in,
    }


def _require_doctor(db: Session, doctor_key: str) -> Doctor:
    doctor = db.get(Doctor, doctor_key)
    if doctor is None:
        raise HTTPException(status_code=404, detail=f"Doctor {doctor_key} was not found.")
    return doctor


def _panel_patient(db: Session, patient_key: str, doctor_key: str) -> Patient:
    _require_doctor(db, doctor_key)
    patient = db.get(Patient, patient_key)
    if patient is None:
        raise HTTPException(status_code=404, detail=f"Patient {patient_key} was not found.")
    if patient.primary_doctor_key != doctor_key:
        raise HTTPException(status_code=403, detail="That patient is not on this doctor's panel.")
    return patient


def _ordered_pair(left: str, right: str) -> tuple[str, str]:
    if left == right:
        raise HTTPException(status_code=422, detail="A consult needs two different doctors.")
    return (left, right) if left < right else (right, left)


def patient_card(db: Session, patient: Patient) -> dict:
    diagnoses = db.scalars(
        select(Diagnosis).where(Diagnosis.patient_key == patient.patient_key)
    ).all()
    prescriptions = db.scalars(
        select(Prescription).where(Prescription.patient_key == patient.patient_key)
    ).all()
    labs = db.scalars(select(Lab).where(Lab.patient_key == patient.patient_key)).all()
    encounters = db.scalars(
        select(Encounter)
        .where(Encounter.patient_key == patient.patient_key)
        .order_by(Encounter.year.desc())
    ).all()
    active = [row for row in prescriptions if row.status == "active"] or list(prescriptions)
    medication_summary = (
        "; ".join(f"{row.generic_medication} {row.strength}" for row in active) or "None recorded"
    )
    lab_summary = (
        "; ".join(f"{row.test_name} {row.value} {row.unit} ({row.result_year})" for row in labs)
        or "None recorded"
    )
    return {
        "patient_key": patient.patient_key,
        "display_label": patient.name,
        "age_group": patient.age_group,
        "age_years": _age_years(patient.age_group),
        "sex_label": SEX_LABELS.get(patient.sex_for_clinical_context, "Not recorded"),
        "primary_diagnosis": diagnoses[0].label if diagnoses else "Not recorded",
        "symptom_labels": json.loads(patient.symptoms_json),
        "active_medication_summary": medication_summary,
        "tobacco_label": SMOKING_LABELS.get(patient.tobacco_use, "Unknown"),
        "pregnancy_label": "Not recorded"
        if patient.pregnancy_status == "not recorded"
        else patient.pregnancy_status,
        "family_history": patient.family_history,
        "surgery_history": patient.surgery_history,
        "lab_summary": lab_summary,
        "allergy_status": patient.allergy_status,
        "sharing_preference_for_peer_cases": patient.sharing_preference_for_peer_cases,
        "source": patient.source,
        "encounters": [
            {
                "encounter_key": row.encounter_key,
                "year": row.year,
                "setting": row.setting,
                "reason": row.reason,
                "assessment": row.assessment,
                "plan": row.plan,
                "handoff_summary_status": row.handoff_summary_status,
            }
            for row in encounters
        ],
    }


@router.get("/doctors")
def list_doctors(specialty: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    query = select(Doctor).order_by(Doctor.doctor_key)
    if specialty:
        query = query.where(Doctor.specialty == specialty)
    return [doctor_payload(row) for row in db.scalars(query).all()]


@router.get("/doctors/{doctor_key}")
def get_doctor(doctor_key: str, db: Session = Depends(get_db)) -> dict:
    return doctor_payload(_require_doctor(db, doctor_key))


def _settings_payload(doctor: Doctor) -> dict:
    return {
        "accepts_peer_consults": doctor.accepts_peer_consults,
        "case_exchange_opt_in": doctor.case_exchange_opt_in,
    }


def _count(db: Session, statement) -> int:
    return int(db.scalar(statement) or 0)


def _consult_between(db: Session, left: str, right: str) -> ConsultThread | None:
    if left == right:
        return None
    low, high = (left, right) if left < right else (right, left)
    return db.scalar(
        select(ConsultThread).where(
            ConsultThread.doctor_a_key == low,
            ConsultThread.doctor_b_key == high,
        )
    )


def _thread_count(db: Session, doctor_key: str) -> int:
    return _count(
        db,
        select(func.count())
        .select_from(ConsultThread)
        .where(
            or_(
                ConsultThread.doctor_a_key == doctor_key,
                ConsultThread.doctor_b_key == doctor_key,
            )
        ),
    )


def _referral_count(db: Session, *, doctor_key: str, incoming: bool, peer_key: str | None = None) -> int:
    column = ReferralRequest.to_doctor_key if incoming else ReferralRequest.from_doctor_key
    other = ReferralRequest.from_doctor_key if incoming else ReferralRequest.to_doctor_key
    statement = select(func.count()).select_from(ReferralRequest).where(column == doctor_key)
    if peer_key is not None:
        statement = statement.where(other == peer_key)
    return _count(db, statement)


def doctor_profile_payload(db: Session, doctor: Doctor, viewer: Doctor) -> dict:
    """Professional card only. Patient rows and contact fields never appear here."""
    is_self = viewer.doctor_key == doctor.doctor_key
    thread = _consult_between(db, viewer.doctor_key, doctor.doctor_key)
    last_message = None
    if thread is not None:
        last_message = db.scalar(
            select(ConsultMessage.text)
            .where(ConsultMessage.thread_id == thread.thread_id)
            .order_by(ConsultMessage.created_at.desc(), ConsultMessage.id.desc())
        )
    if is_self:
        consult_thread_count = _thread_count(db, doctor.doctor_key)
        referrals_in = _referral_count(db, doctor_key=doctor.doctor_key, incoming=True)
        referrals_out = _referral_count(db, doctor_key=doctor.doctor_key, incoming=False)
    else:
        consult_thread_count = 1 if thread is not None else 0
        referrals_out = _referral_count(
            db, doctor_key=viewer.doctor_key, incoming=False, peer_key=doctor.doctor_key
        )
        referrals_in = _referral_count(
            db, doctor_key=viewer.doctor_key, incoming=True, peer_key=doctor.doctor_key
        )
    can_message = (not is_self) and doctor.accepts_peer_consults and viewer.accepts_peer_consults
    can_refer = (not is_self) and doctor.accepts_peer_consults
    payload = {
        "doctor_key": doctor.doctor_key,
        "display_name": doctor.display_name,
        "credentials": doctor.credentials,
        "initials": _initials(doctor.display_name),
        "specialty": doctor.specialty,
        "specialty_title": _specialty_title(doctor.specialty),
        "subspecialty_focus": doctor.subspecialty_focus,
        "practice_type": doctor.practice_type,
        "organization": doctor.organization,
        "state": doctor.state,
        "years_in_practice": doctor.years_in_practice,
        "languages": json.loads(doctor.languages_json),
        "bio": doctor.bio,
        "accepts_peer_consults": doctor.accepts_peer_consults,
        "case_exchange_opt_in": doctor.case_exchange_opt_in,
        "is_self": is_self,
        "can_message": can_message,
        "can_refer": can_refer,
        "consult_thread_count": consult_thread_count,
        "referrals_in": referrals_in,
        "referrals_out": referrals_out,
    }
    if is_self:
        payload["patient_count"] = _count(
            db,
            select(func.count()).select_from(Patient).where(Patient.primary_doctor_key == doctor.doctor_key),
        )
    if not can_message and not is_self:
        if not doctor.accepts_peer_consults:
            payload["message_block_reason"] = "This doctor is not accepting peer consults."
        else:
            payload["message_block_reason"] = "Turn on Accept peer consults to message other doctors."
    if not can_refer and not is_self:
        payload["refer_block_reason"] = "This doctor is not accepting referrals."
    if thread is not None:
        payload["mutual_thread_id"] = thread.thread_id
        if last_message:
            payload["mutual_last_message"] = last_message
    return payload


@router.get("/doctors/{doctor_key}/profile")
def get_doctor_profile(
    doctor_key: str,
    viewer: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    doctor = _require_doctor(db, doctor_key)
    viewer_doctor = _require_doctor(db, viewer)
    return doctor_profile_payload(db, doctor, viewer_doctor)


@router.patch("/doctors/{doctor_key}/settings")
def update_doctor_settings(
    doctor_key: str,
    body: DoctorSettingsUpdate,
    viewer: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    doctor = _require_doctor(db, doctor_key)
    _require_doctor(db, viewer)
    if viewer != doctor_key:
        raise HTTPException(
            status_code=403,
            detail="Only this doctor can update these settings.",
        )
    if body.accepts_peer_consults is not None:
        doctor.accepts_peer_consults = body.accepts_peer_consults
    if body.case_exchange_opt_in is not None:
        doctor.case_exchange_opt_in = body.case_exchange_opt_in
    _commit(db)
    db.refresh(doctor)
    return _settings_payload(doctor)


@router.patch("/doctors/{doctor_key}/profile")
def update_doctor_bio(
    doctor_key: str,
    body: DoctorBioUpdate,
    viewer: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    doctor = _require_doctor(db, doctor_key)
    _require_doctor(db, viewer)
    if viewer != doctor_key:
        raise HTTPException(status_code=403, detail="Only this doctor can edit their bio.")
    doctor.bio = body.bio
    _commit(db)
    db.refresh(doctor)
    return {"bio": doctor.bio}


@router.post("/doctors", status_code=201)
def create_doctor(body: DoctorCreate, db: Session = Depends(get_db)) -> dict:
    doctor = Doctor(
        doctor_key=next_key(db, Doctor.doctor_key, "D"),
        display_name=body.display_name,
        credentials=body.credentials,
        specialty=body.specialty,
        subspecialty_focus=body.subspecialty_focus,
        practice_type=body.practice_type,
        state=body.state,
        years_in_practice=body.years_in_practice,
        languages_json=json.dumps(body.languages),
        case_exchange_opt_in=body.case_exchange_opt_in,
        accepts_peer_consults=body.accepts_peer_consults,
        patient_message_review_required=body.patient_message_review_required,
        professional_email=body.professional_email,
        professional_phone=body.professional_phone,
        license_number=body.license_number,
        npi=body.npi,
        organization=body.organization,
    )
    db.add(doctor)
    _commit(db)
    db.refresh(doctor)
    return doctor_payload(doctor)


@router.get("/patients")
def list_patients(doctor: str | None = None, db: Session = Depends(get_db)) -> list[dict]:
    query = select(Patient).order_by(Patient.patient_key)
    if doctor:
        _require_doctor(db, doctor)
        query = query.where(Patient.primary_doctor_key == doctor)
    rows = db.scalars(query).all()
    return [patient_card(db, row) for row in rows]


@router.get("/patients/{patient_key}")
def get_patient(patient_key: str, doctor: str = Query(...), db: Session = Depends(get_db)) -> dict:
    return patient_card(db, _panel_patient(db, patient_key, doctor))


@router.post("/patients", status_code=201)
def create_patient(body: PatientCreate, db: Session = Depends(get_db)) -> dict:
    _require_doctor(db, body.primary_doctor_key)
    patient = Patient(
        patient_key=next_key(db, Patient.patient_key, "P"),
        name=body.name,
        age_group=body.age_group,
        state=body.state,
        sex_for_clinical_context=body.sex_for_clinical_context,
        preferred_language=body.preferred_language,
        primary_doctor_key=body.primary_doctor_key,
        allergy_status=body.allergy_status,
        symptoms_json=json.dumps(body.symptoms),
        tobacco_use=body.tobacco_use,
        surgery_history=body.surgery_history,
        family_history=body.family_history,
        pregnancy_status=body.pregnancy_status,
        portal_access=body.portal_access,
        email_contact_available=body.email_contact_available,
        messaging_preference=body.messaging_preference,
        patient_education_language=body.patient_education_language,
        sharing_preference_for_peer_cases=body.sharing_preference_for_peer_cases,
        clinical_trial_outreach_preference=body.clinical_trial_outreach_preference,
        source="fully synthetic fixture",
    )
    db.add(patient)
    db.flush()
    for diagnosis in body.diagnoses:
        db.add(Diagnosis(patient_key=patient.patient_key, **diagnosis.model_dump()))
    _commit(db)
    db.refresh(patient)
    return patient_card(db, patient)


def _consult_row(db: Session, thread: ConsultThread, viewer_key: str) -> dict:
    peer_key = thread.doctor_b_key if thread.doctor_a_key == viewer_key else thread.doctor_a_key
    peer = _require_doctor(db, peer_key)
    message = db.scalar(
        select(ConsultMessage)
        .where(ConsultMessage.thread_id == thread.thread_id)
        .order_by(ConsultMessage.created_at.desc(), ConsultMessage.id.desc())
    )
    sort_at = message.created_at if message is not None else thread.created_at
    return {
        "thread_id": thread.thread_id,
        "patient_case_summary": thread.patient_case_summary,
        "created_at": thread.created_at.isoformat(),
        **doctor_payload(peer),
        "last_message": _message_preview(message),
        "unread_count": 0,
        "_sort": sort_at,
    }


def _public_consult_row(row: dict) -> dict:
    payload = dict(row)
    payload.pop("_sort", None)
    return payload


@router.get("/consults")
def list_consults(doctor: str = Query(...), db: Session = Depends(get_db)) -> list[dict]:
    requester = _require_doctor(db, doctor)
    threads = db.scalars(
        select(ConsultThread).where(
            or_(
                ConsultThread.doctor_a_key == requester.doctor_key,
                ConsultThread.doctor_b_key == requester.doctor_key,
            )
        )
    ).all()
    payload = []
    for thread in threads:
        peer_key = (
            thread.doctor_b_key if thread.doctor_a_key == requester.doctor_key else thread.doctor_a_key
        )
        peer = db.get(Doctor, peer_key)
        if peer is None or not peer.accepts_peer_consults:
            continue
        payload.append(_consult_row(db, thread, requester.doctor_key))
    payload.sort(key=lambda row: row["_sort"], reverse=True)
    return [_public_consult_row(row) for row in payload]


@router.post("/consults")
def open_consult(
    body: ConsultOpen,
    response: Response,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    requester = _require_doctor(db, doctor)
    peer = _require_doctor(db, body.peer_doctor_key)
    thread = _consult_between(db, requester.doctor_key, peer.doctor_key)
    created = False
    if thread is None:
        if not peer.accepts_peer_consults:
            raise HTTPException(
                status_code=403,
                detail="That doctor is not accepting peer consults.",
            )
        if not requester.accepts_peer_consults:
            raise HTTPException(
                status_code=403,
                detail="Turn on Accept peer consults before messaging another doctor.",
            )
        low, high = _ordered_pair(requester.doctor_key, peer.doctor_key)
        thread = ConsultThread(
            thread_id=next_key(db, ConsultThread.thread_id, "T"),
            doctor_a_key=low,
            doctor_b_key=high,
            patient_case_summary=None,
            created_at=datetime.utcnow(),
        )
        db.add(thread)
        _commit(db)
        db.refresh(thread)
        created = True
        response.status_code = 201
    row = _public_consult_row(_consult_row(db, thread, requester.doctor_key))
    row["created"] = created
    return row


def _require_thread_member(db: Session, thread_id: str, doctor_key: str) -> ConsultThread:
    doctor = _require_doctor(db, doctor_key)
    thread = db.get(ConsultThread, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail=f"Consult thread {thread_id} was not found.")
    if doctor.doctor_key not in {thread.doctor_a_key, thread.doctor_b_key}:
        raise HTTPException(status_code=403, detail="You are not part of this consult thread.")
    return thread


@router.get("/consults/{thread_id}/messages")
def list_messages(
    thread_id: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> list[dict]:
    thread = _require_thread_member(db, thread_id, doctor)
    rows = db.scalars(
        select(ConsultMessage)
        .where(ConsultMessage.thread_id == thread.thread_id)
        .order_by(ConsultMessage.created_at, ConsultMessage.id)
    ).all()
    return [_message_payload(row) for row in rows]


@router.post("/consults/{thread_id}/messages", status_code=201)
def create_message(
    thread_id: str,
    body: ConsultMessageCreate,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    thread = _require_thread_member(db, thread_id, doctor)
    sender = _require_doctor(db, doctor)
    peer_key = thread.doctor_b_key if thread.doctor_a_key == sender.doctor_key else thread.doctor_a_key
    peer = _require_doctor(db, peer_key)
    if not sender.accepts_peer_consults or not peer.accepts_peer_consults:
        if not peer.accepts_peer_consults:
            reason = "That doctor is not accepting peer consults."
        else:
            reason = "This consult is read-only because peer consults are turned off."
        raise HTTPException(status_code=403, detail=reason)
    text = body.text.strip()
    if not text or len(text) > 1000:
        raise HTTPException(status_code=422, detail="A consult message must be 1-1000 characters.")
    message = ConsultMessage(
        thread_id=thread.thread_id,
        sender_doctor_key=sender.doctor_key,
        text=text,
        created_at=datetime.utcnow(),
    )
    db.add(message)
    _commit(db)
    db.refresh(message)
    return _message_payload(message)


def _remember_similar_cases(db: Session, patient: Patient, doctor: Doctor) -> None:
    """Store shared-diagnosis peers once. Existing rows stay until a later seed replaces them."""
    if patient.sharing_preference_for_peer_cases != "de-identified case only":
        return
    if not doctor.case_exchange_opt_in:
        doctor.case_exchange_opt_in = True
    codes = set(
        db.scalars(select(Diagnosis.code).where(Diagnosis.patient_key == patient.patient_key))
    )
    if not codes:
        return
    scored: list[tuple[float, Patient, Doctor]] = []
    others = db.scalars(
        select(Patient).where(Patient.primary_doctor_key != patient.primary_doctor_key)
    ).all()
    for other in others:
        if other.sharing_preference_for_peer_cases != "de-identified case only":
            continue
        other_doctor = db.get(Doctor, other.primary_doctor_key)
        if other_doctor is None or not other_doctor.case_exchange_opt_in:
            continue
        shared = codes & set(
            db.scalars(select(Diagnosis.code).where(Diagnosis.patient_key == other.patient_key))
        )
        if not shared:
            continue
        scored.append((float(len(shared)), other, other_doctor))
    scored.sort(key=lambda item: item[0], reverse=True)
    for score, other, other_doctor in scored[:8]:
        db.add(
            CaseMatch(
                query_patient_key=patient.patient_key,
                candidate_patient_key=other.patient_key,
                query_doctor_key=patient.primary_doctor_key,
                candidate_doctor_key=other_doctor.doctor_key,
                matching_feature="same diagnosis code",
                review_status="unreviewed",
                score=score,
            )
        )
    _commit(db)


@router.get("/patients/{patient_key}/similar")
def similar_cases(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> list[dict]:
    patient = _panel_patient(db, patient_key, doctor)
    doctor_row = _require_doctor(db, doctor)
    rows = db.scalars(
        select(CaseMatch).where(
            or_(
                CaseMatch.query_patient_key == patient_key,
                CaseMatch.candidate_patient_key == patient_key,
            )
        )
    ).all()
    if not rows:
        _remember_similar_cases(db, patient, doctor_row)
        rows = db.scalars(
            select(CaseMatch).where(
                or_(
                    CaseMatch.query_patient_key == patient_key,
                    CaseMatch.candidate_patient_key == patient_key,
                )
            )
        ).all()
    payload = []
    for row in rows:
        if row.query_patient_key == patient_key:
            other_patient_key = row.candidate_patient_key
            other_doctor_key = row.candidate_doctor_key
        else:
            other_patient_key = row.query_patient_key
            other_doctor_key = row.query_doctor_key
        other_patient = db.get(Patient, other_patient_key)
        other_doctor = db.get(Doctor, other_doctor_key)
        if other_patient is None or other_doctor is None:
            continue
        if other_patient.sharing_preference_for_peer_cases != "de-identified case only":
            continue
        if not other_doctor.case_exchange_opt_in:
            continue
        diagnosis = db.scalar(
            select(Diagnosis).where(Diagnosis.patient_key == other_patient.patient_key)
        )
        payload.append(
            {
                "patient_key": other_patient.patient_key,
                "age_group": other_patient.age_group,
                "sex_label": SEX_LABELS.get(other_patient.sex_for_clinical_context, "Not recorded"),
                "diagnosis_label": diagnosis.label if diagnosis else "Not recorded",
                "diagnosis_code": diagnosis.code if diagnosis else None,
                "matching_feature": row.matching_feature,
                "score": row.score,
                "review_status": row.review_status,
                "candidate_doctor_key": other_doctor.doctor_key,
                "candidate_accepts_peer_consults": other_doctor.accepts_peer_consults,
            }
        )
    return payload


@router.get("/patients/{patient_key}/handoff")
def handoff_summary(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = _panel_patient(db, patient_key, doctor)
    return build_handoff_summary(db, patient, doctor)


def build_handoff_summary(db: Session, patient: Patient, doctor: str) -> dict:
    diagnoses = db.scalars(select(Diagnosis).where(Diagnosis.patient_key == patient.patient_key)).all()
    allergies = db.scalars(select(Allergy).where(Allergy.patient_key == patient.patient_key)).all()
    prescriptions = db.scalars(
        select(Prescription).where(
            Prescription.patient_key == patient.patient_key,
            Prescription.status == "active",
        )
    ).all()
    labs = db.scalars(select(Lab).where(Lab.patient_key == patient.patient_key)).all()
    encounters = db.scalars(
        select(Encounter)
        .where(Encounter.patient_key == patient.patient_key)
        .order_by(Encounter.year.desc())
    ).all()
    followups = db.scalars(select(Followup).where(Followup.patient_key == patient.patient_key)).all()
    return {
        "patient_key": patient.patient_key,
        "patient_display_label": patient.name,
        "age_group": patient.age_group,
        "sex_for_clinical_context": SEX_LABELS.get(
            patient.sex_for_clinical_context, "Not recorded"
        ),
        "state": patient.state,
        "preferred_language": patient.preferred_language,
        "doctor_key": doctor,
        "status": "draft not clinically verified",
        "source": patient.source,
        "symptoms": json.loads(patient.symptoms_json),
        "tobacco_use": patient.tobacco_use,
        "pregnancy_status": patient.pregnancy_status,
        "surgery_history": patient.surgery_history,
        "family_history": patient.family_history,
        "allergy_status": patient.allergy_status,
        "diagnoses": [
            {"label": row.label, "code": row.code, "status": row.status} for row in diagnoses
        ],
        "allergies": [
            {"substance": row.substance, "reaction": row.reaction, "status": row.status}
            for row in allergies
        ],
        "active_prescriptions": [
            {
                "generic_medication": row.generic_medication,
                "strength": row.strength,
                "status": row.status,
            }
            for row in prescriptions
        ],
        "labs": [
            {
                "test_name": row.test_name,
                "value": row.value,
                "unit": row.unit,
                "result_year": row.result_year,
                "flag": row.flag,
            }
            for row in labs
        ],
        "encounters": [
            {
                "encounter_key": row.encounter_key,
                "year": row.year,
                "reason": row.reason,
                "assessment": row.assessment,
                "plan": row.plan,
            }
            for row in encounters
        ],
        "followups_pending_approval": [
            row.followup_key for row in followups if not row.clinician_approved
        ],
    }


def _message_preview(message: ConsultMessage | None) -> dict | None:
    if message is None:
        return None
    return {"text": message.text, "created_at": message.created_at.isoformat()}


def _message_payload(message: ConsultMessage) -> dict:
    return {
        "id": message.id,
        "thread_id": message.thread_id,
        "sender_doctor_key": message.sender_doctor_key,
        "text": message.text,
        "created_at": message.created_at.isoformat(),
    }
