import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from keys import next_key
from models import (
    Allergy,
    CaseMatch,
    ConsultThread,
    Diagnosis,
    Doctor,
    Encounter,
    Followup,
    Lab,
    Message,
    Patient,
    Prescription,
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


class ConsultMessageCreate(BaseModel):
    doctor_key: str
    peer_doctor_key: str
    text: str = Field(min_length=1, max_length=2000)


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
        "display_label": patient.patient_key,
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


@router.get("/consults")
def list_consults(doctor: str = Query(...), db: Session = Depends(get_db)) -> list[dict]:
    requester = _require_doctor(db, doctor)
    peers = db.scalars(
        select(Doctor)
        .where(Doctor.accepts_peer_consults.is_(True), Doctor.doctor_key != requester.doctor_key)
        .order_by(Doctor.display_name)
    ).all()
    payload = []
    for peer in peers:
        low, high = _ordered_pair(requester.doctor_key, peer.doctor_key)
        thread = db.scalar(
            select(ConsultThread).where(
                ConsultThread.doctor_low_key == low,
                ConsultThread.doctor_high_key == high,
            )
        )
        last_message = ""
        if thread is not None:
            message = db.scalar(
                select(Message)
                .where(Message.thread_key == thread.thread_key)
                .order_by(Message.created_at.desc())
            )
            if message is not None:
                last_message = message.text
        payload.append(
            {
                "doctor_key": peer.doctor_key,
                "display_name": peer.display_name,
                "initials": _initials(peer.display_name),
                "specialty": peer.specialty,
                "specialty_title": _specialty_title(peer.specialty),
                "last_message": last_message,
            }
        )
    return payload


@router.get("/consults/{peer_doctor_key}/messages")
def list_messages(
    peer_doctor_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> list[dict]:
    _require_doctor(db, doctor)
    _require_doctor(db, peer_doctor_key)
    low, high = _ordered_pair(doctor, peer_doctor_key)
    thread = db.scalar(
        select(ConsultThread).where(
            ConsultThread.doctor_low_key == low,
            ConsultThread.doctor_high_key == high,
        )
    )
    if thread is None:
        return []
    rows = db.scalars(
        select(Message).where(Message.thread_key == thread.thread_key).order_by(Message.created_at)
    ).all()
    return [_message_payload(row) for row in rows]


@router.post("/consults/messages", status_code=201)
def create_message(body: ConsultMessageCreate, db: Session = Depends(get_db)) -> dict:
    sender = _require_doctor(db, body.doctor_key)
    peer = _require_doctor(db, body.peer_doctor_key)
    if not sender.accepts_peer_consults or not peer.accepts_peer_consults:
        raise HTTPException(
            status_code=403,
            detail="Both doctors must accept peer consults before a message can be stored.",
        )
    low, high = _ordered_pair(sender.doctor_key, peer.doctor_key)
    thread = db.scalar(
        select(ConsultThread).where(
            ConsultThread.doctor_low_key == low,
            ConsultThread.doctor_high_key == high,
        )
    )
    if thread is None:
        thread = ConsultThread(
            thread_key=next_key(db, ConsultThread.thread_key, "T"),
            doctor_low_key=low,
            doctor_high_key=high,
            created_at=datetime.utcnow(),
        )
        db.add(thread)
        db.flush()
    message = Message(
        message_key=next_key(db, Message.message_key, "M"),
        thread_key=thread.thread_key,
        sender_doctor_key=sender.doctor_key,
        text=body.text.strip(),
        created_at=datetime.utcnow(),
    )
    db.add(message)
    _commit(db)
    db.refresh(message)
    return _message_payload(message)


@router.get("/patients/{patient_key}/similar")
def similar_cases(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> list[dict]:
    _panel_patient(db, patient_key, doctor)
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
        "doctor_key": doctor,
        "status": "draft not clinically verified",
        "source": patient.source,
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


def _message_payload(message: Message) -> dict:
    return {
        "message_key": message.message_key,
        "sender_doctor_key": message.sender_doctor_key,
        "text": message.text,
        "timestamp": message.created_at.strftime("%b %d, %Y %I:%M %p"),
    }
