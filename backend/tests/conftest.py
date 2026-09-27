"""Shared isolated fixtures for the root FastAPI backend tests."""
import os

# Keep importing the app from ever creating or touching the developer's default clinic.db.
os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app
from models import CaseMatch, Diagnosis, Doctor, Patient


@pytest.fixture
def api_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with TestSession() as db:
        db.add_all(
            [
                Doctor(
                    doctor_key="D011",
                    display_name="Dr. Aisha Ali",
                    credentials="MD",
                    specialty="Primary Care",
                    subspecialty_focus="General practice",
                    practice_type="community",
                    state="GA",
                    years_in_practice=8,
                    languages_json='["English"]',
                    case_exchange_opt_in=True,
                    accepts_peer_consults=True,
                    patient_message_review_required=True,
                    professional_email="d011@example.invalid",
                    professional_phone=None,
                    license_number=None,
                    npi=None,
                    organization="Synthetic Clinic",
                ),
                Doctor(
                    doctor_key="D012",
                    display_name="Dr. Jordan Morgan",
                    credentials="MD",
                    specialty="Cardiology",
                    subspecialty_focus="Heart failure",
                    practice_type="community",
                    state="GA",
                    years_in_practice=8,
                    languages_json='["English"]',
                    case_exchange_opt_in=True,
                    accepts_peer_consults=True,
                    patient_message_review_required=True,
                    professional_email="d012@example.invalid",
                    professional_phone=None,
                    license_number=None,
                    npi=None,
                    organization="Synthetic Clinic",
                ),
                Doctor(
                    doctor_key="D013",
                    display_name="Dr. Leena Morris",
                    credentials="MD",
                    specialty="Neurology",
                    subspecialty_focus="Movement disorders",
                    practice_type="community",
                    state="GA",
                    years_in_practice=8,
                    languages_json='["English"]',
                    case_exchange_opt_in=True,
                    accepts_peer_consults=True,
                    patient_message_review_required=True,
                    professional_email="d013@example.invalid",
                    professional_phone=None,
                    license_number=None,
                    npi=None,
                    organization="Synthetic Clinic",
                ),
            ]
        )
        db.add(
            Patient(
                patient_key="P001",
                name="Synthetic Patient",
                age_group="45-54",
                state="GA",
                sex_for_clinical_context="female",
                preferred_language="English",
                primary_doctor_key="D011",
                allergy_status="reported",
                symptoms_json='["dyspnea", "fatigue"]',
                tobacco_use="never",
                surgery_history="not recorded",
                family_history="not recorded",
                pregnancy_status="not recorded",
                portal_access=False,
                email_contact_available=False,
                messaging_preference="unavailable",
                patient_education_language="English",
                sharing_preference_for_peer_cases="not documented",
                clinical_trial_outreach_preference="not documented",
                source="synthetic test fixture",
            )
        )
        db.add(
            Patient(
                patient_key="P002",
                name="Other Synthetic Patient",
                age_group="55-64",
                state="GA",
                sex_for_clinical_context="male",
                preferred_language="English",
                primary_doctor_key="D012",
                allergy_status="none reported",
                symptoms_json='["headache"]',
                tobacco_use="unknown",
                surgery_history="not recorded",
                family_history="not recorded",
                pregnancy_status="not recorded",
                portal_access=False,
                email_contact_available=False,
                messaging_preference="unavailable",
                patient_education_language="English",
                sharing_preference_for_peer_cases="not documented",
                clinical_trial_outreach_preference="not documented",
                source="synthetic test fixture",
            )
        )
        db.add(
            Diagnosis(
                patient_key="P001",
                label="Heart failure",
                code_system="ICD-10-CM",
                code="I50.9",
                status="active",
                first_recorded_year=2025,
            )
        )
        db.add(
            CaseMatch(
                query_patient_key="P001",
                candidate_patient_key="P002",
                query_doctor_key="D011",
                candidate_doctor_key="D012",
                matching_feature="heart failure",
                review_status="reviewed",
                score=0.8,
            )
        )
        db.commit()

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
