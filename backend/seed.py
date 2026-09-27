import json
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from checks import run_checks
from database import Base, SessionLocal, engine
from models import (
    Allergy,
    CaseMatch,
    ConsultMessage,
    ConsultThread,
    Diagnosis,
    Doctor,
    DoctorNotification,
    Encounter,
    Followup,
    Lab,
    Patient,
    Prescription,
)

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT.parent / "data"


def _load(name: str) -> list[dict]:
    path = DATA_DIR / f"{name}.json"
    if not path.exists():
        raise SystemExit(f"Missing fixture file: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"{path} must be a JSON array")
    return payload


def _require(row: dict, fields: set[str], label: str) -> None:
    missing = fields - row.keys()
    if missing:
        raise SystemExit(f"{label} is missing fields: {sorted(missing)}")


def seed() -> None:
    with engine.begin() as connection:
        if connection.dialect.name == "sqlite":
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        Base.metadata.drop_all(bind=connection)
        Base.metadata.create_all(bind=connection)

    doctors = _load("doctors")
    patients = _load("patients")
    prescriptions = _load("prescriptions")
    labs = _load("labs")
    encounters = _load("encounters")
    followups = _load("followups")
    case_matches = _load("case_matches")

    with SessionLocal() as db:
        for row in doctors:
            _require(
                row,
                {
                    "doctor_key",
                    "display_name",
                    "credentials",
                    "specialty",
                    "subspecialty_focus",
                    "practice_type",
                    "state",
                    "years_in_practice",
                    "languages",
                    "case_exchange_opt_in",
                    "accepts_peer_consults",
                    "patient_message_review_required",
                    "professional_email",
                    "professional_phone",
                    "license_number",
                    "npi",
                    "organization",
                },
                row.get("doctor_key", "doctor"),
            )
            db.add(
                Doctor(
                    doctor_key=row["doctor_key"],
                    display_name=row["display_name"],
                    credentials=row["credentials"],
                    specialty=row["specialty"],
                    subspecialty_focus=row["subspecialty_focus"],
                    practice_type=row["practice_type"],
                    state=row["state"],
                    years_in_practice=row["years_in_practice"],
                    languages_json=json.dumps(row["languages"]),
                    case_exchange_opt_in=row["case_exchange_opt_in"],
                    accepts_peer_consults=row["accepts_peer_consults"],
                    patient_message_review_required=row["patient_message_review_required"],
                    professional_email=row["professional_email"],
                    professional_phone=row["professional_phone"],
                    license_number=row["license_number"],
                    npi=row["npi"],
                    organization=row["organization"],
                    bio=None,
                )
            )
        db.flush()

        for row in patients:
            _require(
                row,
                {
                    "patient_key",
                    "name",
                    "age",
                    "state",
                    "sex_for_clinical_context",
                    "preferred_language",
                    "primary_doctor_key",
                    "diagnoses",
                    "allergies",
                    "allergy_status",
                    "relevant_medical_history",
                    "family_medical_history",
                    "current_medications",
                    "alcohol_use",
                    "smoking_status",
                    "lab_results",
                    "pregnancy_status",
                    "immune_status",
                    "latest_visit_symptoms",
                    "portal_access",
                    "email_contact_available",
                    "messaging_preference",
                    "patient_education_language",
                    "sharing_preference_for_peer_cases",
                    "clinical_trial_outreach_preference",
                    "source",
                },
                row.get("patient_key", "patient"),
            )
            db.add(
                Patient(
                    patient_key=row["patient_key"],
                    name=row["name"],
                    age=row["age"],
                    state=row["state"],
                    sex_for_clinical_context=row["sex_for_clinical_context"],
                    preferred_language=row["preferred_language"],
                    primary_doctor_key=row["primary_doctor_key"],
                    allergy_status=row["allergy_status"],
                    relevant_medical_history=row["relevant_medical_history"],
                    family_medical_history=row["family_medical_history"],
                    current_medications=row["current_medications"],
                    alcohol_use=row["alcohol_use"],
                    smoking_status=row["smoking_status"],
                    lab_results=row["lab_results"],
                    pregnancy_status=row["pregnancy_status"],
                    immune_status=row["immune_status"],
                    latest_visit_symptoms_json=json.dumps(row["latest_visit_symptoms"]),
                    portal_access=row["portal_access"],
                    email_contact_available=row["email_contact_available"],
                    messaging_preference=row["messaging_preference"],
                    patient_education_language=row["patient_education_language"],
                    sharing_preference_for_peer_cases=row["sharing_preference_for_peer_cases"],
                    clinical_trial_outreach_preference=row["clinical_trial_outreach_preference"],
                    source=row["source"],
                )
            )
            for diagnosis in row["diagnoses"]:
                db.add(
                    Diagnosis(
                        patient_key=row["patient_key"],
                        label=diagnosis["label"],
                        code_system=diagnosis["code_system"],
                        code=diagnosis["code"],
                        status=diagnosis["status"],
                        first_recorded_year=diagnosis["first_recorded_year"],
                    )
                )
            for allergy in row["allergies"]:
                db.add(
                    Allergy(
                        patient_key=row["patient_key"],
                        substance=allergy["substance"],
                        reaction=allergy["reaction"],
                        status=allergy["status"],
                    )
                )
        db.flush()

        for row in prescriptions:
            db.add(Prescription(**row))
        for row in labs:
            db.add(Lab(**row))
        for row in encounters:
            _require(
                row,
                {
                    "encounter_key",
                    "patient_key",
                    "doctor_key",
                    "visit_date",
                    "diagnosis",
                    "summary",
                    "symptoms",
                    "current_medications",
                    "alcohol_use",
                    "smoking_status",
                    "pregnancy_status",
                    "immune_status",
                    "lab_results",
                },
                row.get("encounter_key", "encounter"),
            )
            db.add(
                Encounter(
                    encounter_key=row["encounter_key"],
                    patient_key=row["patient_key"],
                    doctor_key=row["doctor_key"],
                    visit_date=row["visit_date"],
                    diagnosis=row["diagnosis"],
                    summary=row["summary"],
                    symptoms_json=json.dumps(row["symptoms"]),
                    current_medications=row["current_medications"],
                    alcohol_use=row["alcohol_use"],
                    smoking_status=row["smoking_status"],
                    pregnancy_status=row["pregnancy_status"],
                    immune_status=row["immune_status"],
                    lab_results=row["lab_results"],
                )
            )
        db.flush()
        for row in followups:
            db.add(Followup(**row))
        for row in case_matches:
            db.add(
                CaseMatch(
                    query_patient_key=row["query_patient_key"],
                    candidate_patient_key=row["candidate_patient_key"],
                    query_doctor_key=row["query_doctor_key"],
                    candidate_doctor_key=row["candidate_doctor_key"],
                    matching_feature=row["matching_feature"],
                    review_status=row["review_status"],
                    score=row["score"],
                )
            )

        _seed_consults(db)
        _seed_notifications(db)
        db.commit()
        errors, warnings = run_checks(db)
        doctor_count = len(db.scalars(select(Doctor)).all())
        patient_count = len(db.scalars(select(Patient)).all())

    for warning in warnings:
        print(f"WARNING {warning}")
    for error in errors:
        print(f"ERROR {error}")
    if errors:
        raise SystemExit(1)
    print(f"Loaded {doctor_count} doctors and {patient_count} patients from {DATA_DIR}.")
    print("Clean.")


def _seed_consults(db) -> None:
    """Load deterministic peer-consult threads and messages from fixtures."""
    threads = _load("consult_threads")
    messages = _load("consult_messages")
    for row in threads:
        _require(
            row,
            {"thread_id", "doctor_a_key", "doctor_b_key", "patient_case_summary", "created_at"},
            row.get("thread_id", "consult thread"),
        )
        db.add(
            ConsultThread(
                thread_id=row["thread_id"],
                doctor_a_key=row["doctor_a_key"],
                doctor_b_key=row["doctor_b_key"],
                patient_case_summary=row["patient_case_summary"],
                created_at=datetime.fromisoformat(row["created_at"]),
            )
        )
    db.flush()
    for row in messages:
        _require(
            row,
            {"id", "thread_id", "sender_doctor_key", "text", "created_at"},
            f"consult message {row.get('id', '?')}",
        )
        db.add(
            ConsultMessage(
                id=row["id"],
                thread_id=row["thread_id"],
                sender_doctor_key=row["sender_doctor_key"],
                text=row["text"],
                created_at=datetime.fromisoformat(row["created_at"]),
            )
        )



def _seed_notifications(db) -> None:
    """Load in-app doctor inbox items from fixtures."""
    rows = _load("notifications")
    for row in rows:
        _require(
            row,
            {
                "notification_key",
                "doctor_key",
                "type",
                "title",
                "sender",
                "brand",
                "preview",
                "body",
                "thread_id",
                "find_suitable_patients",
                "opens_chat",
                "unread_count",
                "created_at",
                "payload",
            },
            row.get("notification_key", "notification"),
        )
        db.add(
            DoctorNotification(
                notification_key=row["notification_key"],
                doctor_key=row["doctor_key"],
                type=row["type"],
                title=row["title"],
                sender=row["sender"],
                brand=row["brand"],
                preview=row["preview"],
                body=row["body"],
                thread_id=row["thread_id"],
                link_url=row.get("link_url"),
                link_button_label=row.get("link_button_label"),
                find_suitable_patients=bool(row["find_suitable_patients"]),
                opens_chat=bool(row["opens_chat"]),
                unread_count=int(row["unread_count"]),
                payload_json=json.dumps(row["payload"]),
                created_at=datetime.fromisoformat(row["created_at"]),
                read_at=None,
            )
        )


if __name__ == "__main__":
    seed()
