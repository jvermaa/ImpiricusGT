import json
import sys
from pathlib import Path

from sqlalchemy import select

from checks import run_checks
from database import Base, SessionLocal, engine
from models import (
    Allergy,
    CaseMatch,
    Diagnosis,
    Doctor,
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
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

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
                )
            )
        db.flush()

        for row in patients:
            _require(
                row,
                {
                    "patient_key",
                    "name",
                    "age_group",
                    "state",
                    "sex_for_clinical_context",
                    "preferred_language",
                    "primary_doctor_key",
                    "diagnoses",
                    "allergies",
                    "allergy_status",
                    "symptoms",
                    "background",
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
            background = row["background"]
            db.add(
                Patient(
                    patient_key=row["patient_key"],
                    name=row["name"],
                    age_group=row["age_group"],
                    state=row["state"],
                    sex_for_clinical_context=row["sex_for_clinical_context"],
                    preferred_language=row["preferred_language"],
                    primary_doctor_key=row["primary_doctor_key"],
                    allergy_status=row["allergy_status"],
                    symptoms_json=json.dumps(row["symptoms"]),
                    tobacco_use=background["tobacco_use"],
                    surgery_history=background["surgery_history"],
                    family_history=background["family_history"],
                    pregnancy_status=background["pregnancy_status"],
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
            db.add(Encounter(**row))
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


if __name__ == "__main__":
    seed()
