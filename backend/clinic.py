import json
import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from cohort_matcher import rank_cohort_matches, rank_relevant_patients
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
    "other": "Other",
    "unknown": "Unknown",
}

DEFAULT_PATIENT_EMAIL = "harisamser27@gmail.com"
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


class SymptomIn(BaseModel):
    name: str
    duration: str
    frequency: str
    trigger: str
    onset: str


class PatientCreate(BaseModel):
    name: str | None = None
    email_address: str | None = None
    age: int | None = None
    state: str | None = None
    sex_for_clinical_context: str | None = None
    preferred_language: str | None = None
    primary_doctor_key: str | None = None
    allergy_status: str | None = None
    relevant_medical_history: str | None = None
    family_medical_history: str | None = None
    current_medications: str | None = None
    alcohol_use: str | None = None
    smoking_status: str | None = None
    lab_results: str | None = None
    pregnancy_status: str | None = None
    immune_status: str | None = None
    latest_visit_symptoms: list[SymptomIn] = Field(default_factory=list)
    portal_access: bool = False
    email_contact_available: bool = False
    messaging_preference: str | None = None
    patient_education_language: str | None = None
    sharing_preference_for_peer_cases: str | None = None
    clinical_trial_outreach_preference: str | None = None
    primary_diagnosis: str | None = None
    diagnoses: list[DiagnosisIn] = Field(default_factory=list)


class VisitWrite(BaseModel):
    visit_date: str | None = None
    diagnosis: str = ""
    summary: str = ""
    symptoms: list[SymptomIn] = Field(default_factory=list)
    current_medications: str = ""
    alcohol_use: str = ""
    smoking_status: str = ""
    pregnancy_status: str = ""
    immune_status: str = ""
    lab_results: str = ""


class PatientUpdate(BaseModel):
    name: str | None = None
    email_address: str | None = None
    age: int | None = None
    state: str | None = None
    sex_for_clinical_context: str | None = None
    preferred_language: str | None = None
    allergy_status: str | None = None
    relevant_medical_history: str | None = None
    family_medical_history: str | None = None
    current_medications: str | None = None
    alcohol_use: str | None = None
    smoking_status: str | None = None
    lab_results: str | None = None
    pregnancy_status: str | None = None
    immune_status: str | None = None
    latest_visit_symptoms: list[SymptomIn] | None = None
    primary_diagnosis: str | None = None


class CohortSymptom(BaseModel):
    name: str
    duration: str
    frequency: str
    trigger: str
    onset: str


class CohortMatchPreview(BaseModel):
    age_group: str
    diagnosis_label: str
    symptom_labels: list[str]


class CohortMatchDetails(BaseModel):
    age_group: str
    sex_label: str
    diagnosis_label: str
    prescription_label: str
    symptom_labels: list[str]
    symptoms: list[CohortSymptom]
    relevant_medical_history: str
    family_medical_history: str
    current_medications: str
    alcohol_use: str
    smoking_status: str
    immune_status: str
    pregnancy_status: str
    lab_results: str


class CohortMatch(BaseModel):
    match_id: str
    confidence_percent: int = Field(ge=0, le=100)
    rationale: str
    preview: CohortMatchPreview
    details: CohortMatchDetails


class SimilarCohortAnalysisResponse(BaseModel):
    title: str
    explanation: str
    source: Literal["gemini", "fallback"]
    matches: list[CohortMatch]


class RelevantPatientsRequest(BaseModel):
    kind: Literal["drug", "notification"]
    title: str = ""
    summary: str = ""
    details: list[str] = Field(default_factory=list)
    age_min: int | None = Field(default=None, ge=0, le=120)
    age_max: int | None = Field(default=None, ge=0, le=120)
    required_symptoms: list[str] = Field(default_factory=list)
    required_symptoms_mode: Literal["all", "any"] = "all"
    required_symptoms_min_match: int = Field(default=1, ge=1, le=25)
    limit: int = Field(default=10, ge=1, le=25)


class RelevantPatientMatch(BaseModel):
    patient_key: str
    confidence_percent: int = Field(ge=0, le=100)
    rationale: str


class RelevantPatientsResponse(BaseModel):
    title: str
    explanation: str
    source: Literal["gemini", "fallback"]
    matches: list[RelevantPatientMatch]


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


def _symptom_dict(symptom: SymptomIn) -> dict:
    return {
        "name": symptom.name.strip(),
        "duration": symptom.duration.strip(),
        "frequency": symptom.frequency.strip(),
        "trigger": symptom.trigger.strip(),
        "onset": symptom.onset.strip(),
    }


def _read_symptoms(raw: str) -> list[dict]:
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return payload if isinstance(payload, list) else []


def _clean_text(value: str | None, fallback: str) -> str:
    cleaned = (value or "").strip()
    return cleaned or fallback


def _clean_email(value: str | None) -> str:
    cleaned = (value or "").strip().lower()
    return cleaned if EMAIL_PATTERN.match(cleaned) else DEFAULT_PATIENT_EMAIL


def _anonymize_email(value: str) -> str:
    local_part, _, domain = value.partition("@")
    if not domain:
        return "hidden@example.com"
    if len(local_part) <= 1:
        return f"*@" + domain
    return f"{local_part[0]}***@{domain}"


def _clean_age(value: int | None) -> int:
    if isinstance(value, int) and value >= 0:
        return value
    return 0


def _clean_sex(value: str | None) -> str:
    lowered = (value or "").strip().lower()
    if lowered in {"female", "male", "other", "unknown"}:
        return lowered
    return "unknown"


def _age_group(age: int) -> str:
    if age < 0:
        return "Unknown"
    if age < 5:
        return "0-4"
    lower = ((age - 5) // 10) * 10 + 5
    upper = lower + 9
    if lower >= 95:
        return "95+"
    return f"{lower}-{upper}"


def _clean_symptom_entry(raw: dict) -> dict:
    source = raw if isinstance(raw, dict) else {}
    return {
        "name": _clean_text(source.get("name"), "Symptom"),
        "duration": _clean_text(source.get("duration"), "Not specified"),
        "frequency": _clean_text(source.get("frequency"), "Not specified"),
        "trigger": _clean_text(source.get("trigger"), "Not specified"),
        "onset": _clean_text(source.get("onset"), "Not specified"),
    }


def _patient_diagnosis(db: Session, patient_key: str) -> Diagnosis | None:
    return db.scalar(select(Diagnosis).where(Diagnosis.patient_key == patient_key).order_by(Diagnosis.id))


def _prescription_label(db: Session, patient_key: str, fallback: str) -> str:
    active = db.scalar(
        select(Prescription)
        .where(Prescription.patient_key == patient_key, Prescription.status == "active")
        .order_by(Prescription.start_year.desc(), Prescription.prescription_key.desc())
    )
    if active is None:
        return _clean_text(fallback, "Medication list reconciled.")
    return " ".join(
        part
        for part in (
            active.generic_medication.strip(),
            active.strength.strip(),
            active.frequency.strip(),
        )
        if part
    ) or _clean_text(fallback, "Medication list reconciled.")


def _cohort_snapshot(db: Session, patient: Patient, match_id: str) -> dict:
    diagnosis = _patient_diagnosis(db, patient.patient_key)
    symptoms = [_clean_symptom_entry(row) for row in _read_symptoms(patient.latest_visit_symptoms_json)[:3]]
    symptom_labels = [entry["name"] for entry in symptoms if entry["name"]]
    diagnosis_label = diagnosis.label if diagnosis else "Undifferentiated condition"
    return {
        "match_id": match_id,
        "age_group": _age_group(patient.age),
        "sex_label": SEX_LABELS.get(patient.sex_for_clinical_context, "Unknown"),
        "diagnosis_label": diagnosis_label,
        "prescription_label": _prescription_label(db, patient.patient_key, patient.current_medications),
        "symptom_labels": symptom_labels,
        "symptoms": symptoms,
        "relevant_medical_history": _clean_text(patient.relevant_medical_history, "General history reviewed."),
        "family_medical_history": _clean_text(patient.family_medical_history, "Family history reviewed."),
        "current_medications": _clean_text(patient.current_medications, "Medication list reconciled."),
        "alcohol_use": _clean_text(patient.alcohol_use, "None"),
        "smoking_status": _clean_text(patient.smoking_status, "Never smoker"),
        "immune_status": _clean_text(patient.immune_status, "Immunocompetent"),
        "pregnancy_status": _clean_text(patient.pregnancy_status, "N/A"),
        "lab_results": _clean_text(patient.lab_results, "Baseline labs reviewed."),
    }


def _relevant_patient_snapshot(db: Session, patient: Patient) -> dict:
    diagnosis = _patient_diagnosis(db, patient.patient_key)
    symptoms = [_clean_symptom_entry(row) for row in _read_symptoms(patient.latest_visit_symptoms_json)[:4]]
    symptom_labels = [entry["name"] for entry in symptoms if entry["name"]]
    diagnosis_label = diagnosis.label if diagnosis else "Undifferentiated condition"
    visits = db.scalars(
        select(Encounter)
        .where(Encounter.patient_key == patient.patient_key)
        .order_by(Encounter.visit_date.desc(), Encounter.encounter_key.desc())
    ).all()
    recent_visit_summaries = [
        " ".join(
            part
            for part in (
                _clean_text(visit.visit_date, ""),
                _clean_text(visit.diagnosis, ""),
                _clean_text(visit.summary, ""),
            )
            if part
        )[:220]
        for visit in visits[:3]
    ]
    return {
        "patient_key": patient.patient_key,
        "display_label": patient.name,
        "age": patient.age,
        "sex_label": SEX_LABELS.get(patient.sex_for_clinical_context, "Unknown"),
        "diagnosis_label": diagnosis_label,
        "symptom_labels": symptom_labels,
        "current_medications": _clean_text(patient.current_medications, "Medication list reconciled."),
        "relevant_medical_history": _clean_text(patient.relevant_medical_history, "General history reviewed."),
        "family_medical_history": _clean_text(patient.family_medical_history, "Family history reviewed."),
        "lab_results": _clean_text(patient.lab_results, "Baseline labs reviewed."),
        "recent_visit_summaries": recent_visit_summaries,
    }


def _cohort_explanation(query_age_group: str) -> str:
    return (
        "Clinical match based on symptom overlaps, age cohort "
        f"({query_age_group}), and diagnosis matches"
    )


def _relevance_explanation(kind: Literal["drug", "notification"], title: str) -> str:
    topic = "drug profile" if kind == "drug" else "notification context"
    if title:
        return (
            f"Patient relevance ranked from the {topic} ({title}) against diagnosis, symptoms, "
            "history, and recent visit context."
        )
    return f"Patient relevance ranked from the {topic} against diagnosis, symptoms, and history context."


def _normalize_relevance_term(value: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", value.lower()).strip()


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
    encounters = db.scalars(
        select(Encounter)
        .where(Encounter.patient_key == patient.patient_key)
        .order_by(Encounter.visit_date.desc(), Encounter.encounter_key.desc())
    ).all()
    latest_visit = encounters[0] if encounters else None
    return {
        "patient_key": patient.patient_key,
        "display_label": patient.name,
        "email_address": patient.email_address,
        "anonymized_email": _anonymize_email(patient.email_address),
        "age": patient.age,
        "sex_label": SEX_LABELS.get(patient.sex_for_clinical_context, "Unknown"),
        "primary_diagnosis": diagnoses[0].label if diagnoses else "Undifferentiated condition",
        "relevant_medical_history": patient.relevant_medical_history,
        "family_medical_history": patient.family_medical_history,
        "current_medications": patient.current_medications,
        "alcohol_use": patient.alcohol_use,
        "smoking_status": patient.smoking_status,
        "pregnancy_status": patient.pregnancy_status,
        "immune_status": patient.immune_status,
        "lab_results": patient.lab_results,
        "latest_visit_symptoms": _read_symptoms(patient.latest_visit_symptoms_json),
        "latest_visit_lab_results": latest_visit.lab_results if latest_visit else patient.lab_results,
        "allergy_status": patient.allergy_status,
        "sharing_preference_for_peer_cases": patient.sharing_preference_for_peer_cases,
        "source": patient.source,
        "encounters": [
            {
                "encounter_key": row.encounter_key,
                "visit_date": row.visit_date,
                "diagnosis": row.diagnosis,
                "summary": row.summary,
                "symptoms": _read_symptoms(row.symptoms_json),
                "current_medications": row.current_medications,
                "alcohol_use": row.alcohol_use,
                "smoking_status": row.smoking_status,
                "pregnancy_status": row.pregnancy_status,
                "immune_status": row.immune_status,
                "lab_results": row.lab_results,
            }
            for row in encounters
        ],
    }


def _sync_patient_from_latest_visit(db: Session, patient: Patient) -> None:
    latest = db.scalar(
        select(Encounter)
        .where(Encounter.patient_key == patient.patient_key)
        .order_by(Encounter.visit_date.desc(), Encounter.encounter_key.desc())
    )
    if latest is None:
        return
    patient.latest_visit_symptoms_json = latest.symptoms_json
    patient.current_medications = latest.current_medications
    patient.alcohol_use = latest.alcohol_use
    patient.smoking_status = latest.smoking_status
    patient.pregnancy_status = latest.pregnancy_status
    patient.immune_status = latest.immune_status
    patient.lab_results = latest.lab_results


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


@router.post("/patients/relevance/search", response_model=RelevantPatientsResponse)
def find_relevant_patients(
    body: RelevantPatientsRequest,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> RelevantPatientsResponse:
    _require_doctor(db, doctor)
    patients = db.scalars(
        select(Patient)
        .where(Patient.primary_doctor_key == doctor)
        .order_by(Patient.patient_key)
    ).all()
    candidates = [_relevant_patient_snapshot(db, patient) for patient in patients]
    required_symptoms = [
        cleaned
        for cleaned in (_normalize_relevance_term(item) for item in body.required_symptoms)
        if cleaned
    ]
    required_symptoms_mode = body.required_symptoms_mode
    required_symptoms_min_match = max(1, body.required_symptoms_min_match)
    age_min = body.age_min
    age_max = body.age_max

    base_explanation = _relevance_explanation(body.kind, body.title.strip())

    context_details = [str(item).strip() for item in body.details if str(item).strip()]
    if age_min is not None or age_max is not None:
        context_details.append(
            "Age relevance focus: "
            f"{age_min if age_min is not None else 0}-{age_max if age_max is not None else 120}"
        )
    if required_symptoms:
        if required_symptoms_mode == "all":
            context_details.append(f"Symptom relevance focus (all): {', '.join(required_symptoms)}")
        else:
            context_details.append(
                "Symptom relevance focus (any): "
                f"{', '.join(required_symptoms)} | minimum matches: {required_symptoms_min_match}"
            )
    context = {
        "kind": body.kind,
        "title": body.title.strip(),
        "summary": body.summary.strip(),
        "details": context_details,
    }
    source, summary, ranked = rank_relevant_patients(context, candidates, limit=body.limit)
    known_ids = {row["patient_key"] for row in candidates}
    matches: list[RelevantPatientMatch] = []
    for row in ranked:
        patient_key = str(row.get("patient_key") or "").strip()
        if not patient_key or patient_key not in known_ids:
            continue
        matches.append(
            RelevantPatientMatch(
                patient_key=patient_key,
                confidence_percent=int(row.get("confidence_percent") or 0),
                rationale=str(row.get("rationale") or "Patient relevance match."),
            )
        )
        if len(matches) >= body.limit:
            break

    explanation = base_explanation if not summary else f"{base_explanation} {summary}"
    context_title = body.title.strip() or ("Drug relevance" if body.kind == "drug" else "Notification relevance")
    return RelevantPatientsResponse(
        title=context_title,
        explanation=explanation,
        source=source,
        matches=matches,
    )


@router.get("/patients/{patient_key}")
def get_patient(patient_key: str, doctor: str = Query(...), db: Session = Depends(get_db)) -> dict:
    return patient_card(db, _panel_patient(db, patient_key, doctor))


@router.post("/patients", status_code=201)
def create_patient(
    body: PatientCreate,
    doctor: str | None = Query(None),
    db: Session = Depends(get_db),
) -> dict:
    doctor_key = body.primary_doctor_key or doctor
    if doctor_key is None:
        raise HTTPException(status_code=422, detail="A doctor key is required to create a patient.")
    _require_doctor(db, doctor_key)
    diagnosis_label = (body.primary_diagnosis or "").strip()
    patient = Patient(
        patient_key=next_key(db, Patient.patient_key, "P"),
        name=_clean_text(body.name, "New patient"),
        email_address=_clean_email(body.email_address),
        age=_clean_age(body.age),
        state=_clean_text(body.state, "GA"),
        sex_for_clinical_context=_clean_sex(body.sex_for_clinical_context),
        preferred_language=_clean_text(body.preferred_language, "English"),
        primary_doctor_key=doctor_key,
        allergy_status=_clean_text(body.allergy_status, "none reported"),
        relevant_medical_history=_clean_text(
            body.relevant_medical_history,
            "General history reviewed.",
        ),
        family_medical_history=_clean_text(
            body.family_medical_history,
            "Family history reviewed.",
        ),
        current_medications=_clean_text(
            body.current_medications,
            "Medication list reconciled.",
        ),
        alcohol_use=_clean_text(body.alcohol_use, "None"),
        smoking_status=_clean_text(body.smoking_status, "Never smoker"),
        lab_results=_clean_text(body.lab_results, "Baseline labs reviewed."),
        pregnancy_status=_clean_text(body.pregnancy_status, "N/A"),
        immune_status=_clean_text(body.immune_status, "Immunocompetent"),
        latest_visit_symptoms_json=json.dumps([_symptom_dict(item) for item in body.latest_visit_symptoms]),
        portal_access=body.portal_access,
        email_contact_available=body.email_contact_available,
        messaging_preference=_clean_text(body.messaging_preference, "unavailable"),
        patient_education_language=_clean_text(body.patient_education_language, "English"),
        sharing_preference_for_peer_cases=_clean_text(
            body.sharing_preference_for_peer_cases,
            "not documented",
        ),
        clinical_trial_outreach_preference=_clean_text(
            body.clinical_trial_outreach_preference,
            "not documented",
        ),
        source="fully synthetic fixture",
    )
    db.add(patient)
    db.flush()
    for diagnosis in body.diagnoses:
        db.add(Diagnosis(patient_key=patient.patient_key, **diagnosis.model_dump()))
    if not body.diagnoses and diagnosis_label:
        db.add(
            Diagnosis(
                patient_key=patient.patient_key,
                label=diagnosis_label,
                code_system="ICD-10-CM",
                code="R69",
                status="active",
                first_recorded_year=datetime.utcnow().year,
            )
        )
    _commit(db)
    db.refresh(patient)
    return patient_card(db, patient)


@router.patch("/patients/{patient_key}")
def update_patient(
    patient_key: str,
    body: PatientUpdate,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = _panel_patient(db, patient_key, doctor)
    if body.name is not None:
        patient.name = _clean_text(body.name, "New patient")
    if body.email_address is not None:
        patient.email_address = _clean_email(body.email_address)
    if body.age is not None:
        patient.age = _clean_age(body.age)
    if body.state is not None:
        patient.state = _clean_text(body.state, "GA")
    if body.sex_for_clinical_context is not None:
        patient.sex_for_clinical_context = _clean_sex(body.sex_for_clinical_context)
    if body.preferred_language is not None:
        patient.preferred_language = _clean_text(body.preferred_language, "English")
    if body.allergy_status is not None:
        patient.allergy_status = _clean_text(body.allergy_status, "none reported")
    if body.relevant_medical_history is not None:
        patient.relevant_medical_history = _clean_text(
            body.relevant_medical_history,
            "General history reviewed.",
        )
    if body.family_medical_history is not None:
        patient.family_medical_history = _clean_text(
            body.family_medical_history,
            "Family history reviewed.",
        )
    if body.current_medications is not None:
        patient.current_medications = _clean_text(
            body.current_medications,
            "Medication list reconciled.",
        )
    if body.alcohol_use is not None:
        patient.alcohol_use = _clean_text(body.alcohol_use, "None")
    if body.smoking_status is not None:
        patient.smoking_status = _clean_text(body.smoking_status, "Never smoker")
    if body.lab_results is not None:
        patient.lab_results = _clean_text(body.lab_results, "Baseline labs reviewed.")
    if body.pregnancy_status is not None:
        patient.pregnancy_status = _clean_text(body.pregnancy_status, "N/A")
    if body.immune_status is not None:
        patient.immune_status = _clean_text(body.immune_status, "Immunocompetent")
    if body.latest_visit_symptoms is not None:
        patient.latest_visit_symptoms_json = json.dumps(
            [_symptom_dict(item) for item in body.latest_visit_symptoms]
        )

    if body.primary_diagnosis is not None:
        cleaned_diagnosis = body.primary_diagnosis.strip()
        current = db.scalar(
            select(Diagnosis)
            .where(Diagnosis.patient_key == patient.patient_key)
            .order_by(Diagnosis.id)
        )
        if cleaned_diagnosis:
            if current is None:
                db.add(
                    Diagnosis(
                        patient_key=patient.patient_key,
                        label=cleaned_diagnosis,
                        code_system="ICD-10-CM",
                        code="R69",
                        status="active",
                        first_recorded_year=datetime.utcnow().year,
                    )
                )
            else:
                current.label = cleaned_diagnosis
        elif current is not None:
            db.delete(current)

    _commit(db)
    db.refresh(patient)
    return patient_card(db, patient)


def _visit_date(value: str | None) -> str:
    cleaned = (value or "").strip()
    if cleaned:
        return cleaned
    return datetime.utcnow().date().isoformat()


@router.post("/patients/{patient_key}/visits", status_code=201)
def add_visit(
    patient_key: str,
    body: VisitWrite,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = _panel_patient(db, patient_key, doctor)
    encounter = Encounter(
        encounter_key=next_key(db, Encounter.encounter_key, "E"),
        patient_key=patient.patient_key,
        doctor_key=doctor,
        visit_date=_visit_date(body.visit_date),
        diagnosis=body.diagnosis.strip() or "Follow-up assessment",
        summary=body.summary.strip() or "Visit updated from structured intake.",
        symptoms_json=json.dumps([_symptom_dict(item) for item in body.symptoms]),
        current_medications=body.current_medications.strip(),
        alcohol_use=body.alcohol_use.strip(),
        smoking_status=body.smoking_status.strip(),
        pregnancy_status=body.pregnancy_status.strip(),
        immune_status=body.immune_status.strip(),
        lab_results=body.lab_results.strip(),
    )
    db.add(encounter)
    db.flush()
    _sync_patient_from_latest_visit(db, patient)
    _commit(db)
    db.refresh(patient)
    return patient_card(db, patient)


@router.patch("/patients/{patient_key}/visits/{encounter_key}")
def update_visit(
    patient_key: str,
    encounter_key: str,
    body: VisitWrite,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    patient = _panel_patient(db, patient_key, doctor)
    encounter = db.get(Encounter, encounter_key)
    if encounter is None or encounter.patient_key != patient.patient_key:
        raise HTTPException(status_code=404, detail=f"Visit {encounter_key} was not found.")
    encounter.visit_date = _visit_date(body.visit_date)
    encounter.diagnosis = body.diagnosis.strip() or encounter.diagnosis
    encounter.summary = body.summary.strip() or encounter.summary
    encounter.symptoms_json = json.dumps([_symptom_dict(item) for item in body.symptoms])
    encounter.current_medications = body.current_medications.strip()
    encounter.alcohol_use = body.alcohol_use.strip()
    encounter.smoking_status = body.smoking_status.strip()
    encounter.pregnancy_status = body.pregnancy_status.strip()
    encounter.immune_status = body.immune_status.strip()
    encounter.lab_results = body.lab_results.strip()
    _sync_patient_from_latest_visit(db, patient)
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


@router.get("/patients/{patient_key}/similar", response_model=SimilarCohortAnalysisResponse)
def similar_cases(
    patient_key: str,
    doctor: str = Query(...),
    db: Session = Depends(get_db),
) -> SimilarCohortAnalysisResponse:
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
    query_snapshot = _cohort_snapshot(db, patient, "query")
    peer_patients = db.scalars(
        select(Patient).where(
            Patient.patient_key != patient.patient_key,
            Patient.primary_doctor_key != patient.primary_doctor_key,
        )
    ).all()

    candidates: list[dict] = []
    for index, other_patient in enumerate(peer_patients, start=1):
        other_doctor = db.get(Doctor, other_patient.primary_doctor_key)
        if other_doctor is None:
            continue
        if other_patient.sharing_preference_for_peer_cases != "de-identified case only":
            continue
        if not other_doctor.case_exchange_opt_in:
            continue
        candidates.append(_cohort_snapshot(db, other_patient, f"match-{index:03d}"))

    if not candidates:
        return SimilarCohortAnalysisResponse(
            title="Similar Cohort Analysis",
            explanation=_cohort_explanation(query_snapshot["age_group"]),
            source="fallback",
            matches=[],
        )

    source, summary, ranked = rank_cohort_matches(query_snapshot, candidates, limit=10)
    by_id = {row["match_id"]: row for row in candidates}
    matches: list[CohortMatch] = []
    for row in ranked[:10]:
        candidate = by_id.get(row.get("match_id"))
        if candidate is None:
            continue
        matches.append(
            CohortMatch(
                match_id=candidate["match_id"],
                confidence_percent=int(row["confidence_percent"]),
                rationale=str(row.get("rationale") or "Cohort-level similarity match."),
                preview=CohortMatchPreview(
                    age_group=candidate["age_group"],
                    diagnosis_label=candidate["diagnosis_label"],
                    symptom_labels=candidate["symptom_labels"][:3],
                ),
                details=CohortMatchDetails(
                    age_group=candidate["age_group"],
                    sex_label=candidate["sex_label"],
                    diagnosis_label=candidate["diagnosis_label"],
                    prescription_label=candidate["prescription_label"],
                    symptom_labels=candidate["symptom_labels"][:3],
                    symptoms=[CohortSymptom(**symptom) for symptom in candidate["symptoms"][:3]],
                    relevant_medical_history=candidate["relevant_medical_history"],
                    family_medical_history=candidate["family_medical_history"],
                    current_medications=candidate["current_medications"],
                    alcohol_use=candidate["alcohol_use"],
                    smoking_status=candidate["smoking_status"],
                    immune_status=candidate["immune_status"],
                    pregnancy_status=candidate["pregnancy_status"],
                    lab_results=candidate["lab_results"],
                ),
            )
        )

    base_explanation = _cohort_explanation(query_snapshot["age_group"])
    explanation = base_explanation if not summary else f"{base_explanation}. {summary}"
    return SimilarCohortAnalysisResponse(
        title="Similar Cohort Analysis",
        explanation=explanation,
        source=source,
        matches=matches[:10],
    )


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
        .order_by(Encounter.visit_date.desc(), Encounter.encounter_key.desc())
    ).all()
    followups = db.scalars(select(Followup).where(Followup.patient_key == patient.patient_key)).all()
    return {
        "patient_key": patient.patient_key,
        "patient_display_label": patient.name,
        "age": patient.age,
        "sex_for_clinical_context": SEX_LABELS.get(patient.sex_for_clinical_context, "Unknown"),
        "state": patient.state,
        "preferred_language": patient.preferred_language,
        "doctor_key": doctor,
        "status": "draft not clinically verified",
        "source": patient.source,
        "symptoms": _read_symptoms(patient.latest_visit_symptoms_json),
        "alcohol_use": patient.alcohol_use,
        "smoking_status": patient.smoking_status,
        "pregnancy_status": patient.pregnancy_status,
        "immune_status": patient.immune_status,
        "relevant_medical_history": patient.relevant_medical_history,
        "family_medical_history": patient.family_medical_history,
        "current_medications": patient.current_medications,
        "lab_results": patient.lab_results,
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
                "visit_date": row.visit_date,
                "diagnosis": row.diagnosis,
                "summary": row.summary,
                "symptoms": _read_symptoms(row.symptoms_json),
                "current_medications": row.current_medications,
                "alcohol_use": row.alcohol_use,
                "smoking_status": row.smoking_status,
                "pregnancy_status": row.pregnancy_status,
                "immune_status": row.immune_status,
                "lab_results": row.lab_results,
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
