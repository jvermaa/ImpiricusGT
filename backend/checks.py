import re

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

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
    PatientReferral,
    Prescription,
)

KEY_PATTERNS = {
    "doctor": re.compile(r"^D\d{3,}$"),
    "patient": re.compile(r"^P\d{3,}$"),
    "prescription": re.compile(r"^RX\d{3,}$"),
    "lab": re.compile(r"^L\d{3,}$"),
    "encounter": re.compile(r"^E\d{3,}$"),
    "followup": re.compile(r"^F\d{3,}$"),
    "thread": re.compile(r"^T\d{3,}$"),
    "message": re.compile(r"^M\d{3,}$"),
}


def run_checks(db: Session) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    doctors = {row.doctor_key: row for row in db.scalars(select(Doctor)).all()}
    patients = {row.patient_key: row for row in db.scalars(select(Patient)).all()}
    prescriptions = {
        row.prescription_key: row for row in db.scalars(select(Prescription)).all()
    }

    orphans = [
        patient.patient_key
        for patient in patients.values()
        if patient.primary_doctor_key not in doctors
    ]
    if orphans:
        errors.append(f"patients without an existing doctor: {orphans[:8]}")

    bad_dx = [
        row.id
        for row in db.scalars(select(Diagnosis)).all()
        if row.patient_key not in patients
    ]
    bad_allergy = [
        row.id
        for row in db.scalars(select(Allergy)).all()
        if row.patient_key not in patients
    ]
    if bad_dx or bad_allergy:
        errors.append("diagnoses or allergies point at a missing patient")

    bad_clinical = False
    for row in db.scalars(select(Prescription)).all():
        if row.patient_key not in patients or row.prescriber_doctor_key not in doctors:
            bad_clinical = True
    for row in list(db.scalars(select(Lab)).all()) + list(db.scalars(select(Encounter)).all()):
        if row.patient_key not in patients or row.doctor_key not in doctors:
            bad_clinical = True
    if bad_clinical:
        errors.append("a prescription, lab, or encounter references a missing patient or doctor")

    bad_followups = []
    for row in db.scalars(select(Followup)).all():
        prescription = prescriptions.get(row.prescription_key)
        if (
            prescription is None
            or prescription.patient_key != row.patient_key
            or row.doctor_key not in doctors
            or row.patient_key not in patients
        ):
            bad_followups.append(row.followup_key)
    if bad_followups:
        errors.append(f"follow-ups whose prescription is missing or belongs to another patient: {bad_followups[:8]}")

    unapproved_sent = [
        row.followup_key
        for row in db.scalars(select(Followup)).all()
        if row.delivery_status == "sent" and not row.clinician_approved
    ]
    if unapproved_sent:
        errors.append(f"follow-ups sent without clinician approval: {unapproved_sent[:8]}")

    codes_by_patient: dict[str, set[str]] = {}
    for row in db.scalars(select(Diagnosis)).all():
        codes_by_patient.setdefault(row.patient_key, set()).add(row.code)
    bad_matches = []
    for row in db.scalars(select(CaseMatch)).all():
        query_patient = patients.get(row.query_patient_key)
        candidate_patient = patients.get(row.candidate_patient_key)
        query_doctor = doctors.get(row.query_doctor_key)
        candidate_doctor = doctors.get(row.candidate_doctor_key)
        shared = codes_by_patient.get(row.query_patient_key, set()) & codes_by_patient.get(
            row.candidate_patient_key, set()
        )
        if (
            query_patient is None
            or candidate_patient is None
            or query_doctor is None
            or candidate_doctor is None
            or row.query_doctor_key == row.candidate_doctor_key
            or query_patient.primary_doctor_key != row.query_doctor_key
            or candidate_patient.primary_doctor_key != row.candidate_doctor_key
            or not shared
            or not query_doctor.case_exchange_opt_in
            or not candidate_doctor.case_exchange_opt_in
            or query_patient.sharing_preference_for_peer_cases != "de-identified case only"
            or candidate_patient.sharing_preference_for_peer_cases != "de-identified case only"
        ):
            bad_matches.append(row.id)
    if bad_matches:
        errors.append(f"case matches that break consent or diagnosis rules: {bad_matches[:8]}")

    bad_keys = []
    for key in doctors:
        if not KEY_PATTERNS["doctor"].match(key):
            bad_keys.append(key)
    for key in patients:
        if not KEY_PATTERNS["patient"].match(key):
            bad_keys.append(key)
    for key in prescriptions:
        if not KEY_PATTERNS["prescription"].match(key):
            bad_keys.append(key)
    for row in db.scalars(select(Lab)).all():
        if not KEY_PATTERNS["lab"].match(row.lab_key):
            bad_keys.append(row.lab_key)
    for row in db.scalars(select(Encounter)).all():
        if not KEY_PATTERNS["encounter"].match(row.encounter_key):
            bad_keys.append(row.encounter_key)
    for row in db.scalars(select(Followup)).all():
        if not KEY_PATTERNS["followup"].match(row.followup_key):
            bad_keys.append(row.followup_key)
    if bad_keys:
        errors.append(f"keys are not readable D/P/RX/L/E/F ids: {bad_keys[:8]}")

    sms_channels = [
        row.followup_key
        for row in db.scalars(select(Followup)).all()
        if row.channel.lower() in {"sms", "text", "twilio-sms"}
    ]
    if sms_channels:
        errors.append(f"follow-ups use an SMS channel: {sms_channels[:8]}")

    email_mismatch = [
        patient.patient_key
        for patient in patients.values()
        if bool((patient.contact_email or "").strip()) != bool(patient.email_contact_available)
    ]
    if email_mismatch:
        errors.append(
            f"email_contact_available does not match contact_email: {email_mismatch[:8]}"
        )

    bad_referrals = []
    for row in db.scalars(select(PatientReferral)).all():
        recipient = doctors.get(row.to_doctor_key)
        patient = patients.get(row.patient_key)
        if (
            row.from_doctor_key == row.to_doctor_key
            or recipient is None
            or not recipient.accepts_peer_consults
            or patient is None
            or patient.primary_doctor_key != row.from_doctor_key
        ):
            bad_referrals.append(row.id)
    if bad_referrals:
        errors.append(f"referrals fail consult or panel rules: {bad_referrals[:8]}")

    unsynthetic = [
        patient.patient_key
        for patient in patients.values()
        if "synthetic" not in patient.source.lower()
    ]
    if unsynthetic:
        errors.append(f"patients not marked as synthetic fixtures: {unsynthetic[:8]}")

    columns = {column["name"] for column in inspect(db.bind).get_columns("doctors")}
    if "patient_keys" in columns:
        errors.append("doctors.patient_keys is stored; patient panels must be derived from foreign keys")

    bad_messages = []
    threads = {row.thread_key: row for row in db.scalars(select(ConsultThread)).all()}
    for row in db.scalars(select(Message)).all():
        thread = threads.get(row.thread_key)
        if thread is None or row.sender_doctor_key not in {
            thread.doctor_low_key,
            thread.doctor_high_key,
        }:
            bad_messages.append(row.message_key)
            continue
        for doctor_key in (thread.doctor_low_key, thread.doctor_high_key):
            doctor = doctors.get(doctor_key)
            if doctor is None or not doctor.accepts_peer_consults:
                bad_messages.append(row.message_key)
    if bad_messages:
        errors.append(f"consult messages whose sender is outside an opted-in thread: {bad_messages[:8]}")

    if not doctors or not patients:
        warnings.append("database has no doctors or patients loaded")

    return errors, warnings
