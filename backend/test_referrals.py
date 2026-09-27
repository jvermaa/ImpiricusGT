"""API tests for referrals against an isolated in-memory clinic database."""
import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app
from models import Diagnosis, Doctor, Patient


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with TestSession() as db:
        for key, name, specialty in (
            ("D011", "Dr. Aisha Ali", "Primary Care"),
            ("D012", "Dr. Jordan Morgan", "Cardiology"),
            ("D013", "Dr. Leena Morris", "Neurology"),
        ):
            db.add(Doctor(
                doctor_key=key,
                display_name=name,
                credentials="MD",
                specialty=specialty,
                subspecialty_focus="Heart failure" if specialty == "Cardiology" else specialty,
                practice_type="community",
                state="GA",
                years_in_practice=8,
                languages_json='["English"]',
                case_exchange_opt_in=True,
                accepts_peer_consults=True,
                patient_message_review_required=True,
                professional_email=f"{key.lower()}@example.invalid",
                professional_phone=None,
                license_number=None,
                npi=None,
                organization="Synthetic Clinic",
            ))
        db.add(Patient(
            patient_key="P001",
            name="Synthetic Patient",
            age=49,
            state="GA",
            sex_for_clinical_context="female",
            preferred_language="English",
            primary_doctor_key="D011",
            allergy_status="none reported",
            relevant_medical_history="Chronic exertional dyspnea under active monitoring.",
            family_medical_history="Family history reviewed with mild cardiometabolic risk.",
            current_medications="Lisinopril 10mg daily; carvedilol 6.25mg twice daily.",
            alcohol_use="Social",
            smoking_status="Never smoker",
            lab_results="BNP mildly elevated with stable renal profile.",
            pregnancy_status="Not Pregnant",
            immune_status="Immunocompetent",
            latest_visit_symptoms_json='[{"name":"dyspnea","duration":"3 weeks","frequency":"Daily","trigger":"Exertion","onset":"Gradual"},{"name":"fatigue","duration":"2 weeks","frequency":"Daily","trigger":"Late afternoon","onset":"Gradual"}]',
            portal_access=False,
            email_contact_available=False,
            messaging_preference="unavailable",
            patient_education_language="English",
            sharing_preference_for_peer_cases="not documented",
            clinical_trial_outreach_preference="not documented",
            source="synthetic test fixture",
        ))
        db.add(Diagnosis(
            patient_key="P001",
            label="Heart failure",
            code_system="ICD-10-CM",
            code="I50.9",
            status="active",
            first_recorded_year=2025,
        ))
        db.commit()

    def override_get_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def create_referral(client: TestClient) -> dict:
    response = client.post("/referrals", json={
        "from_doctor_key": "D011",
        "to_doctor_key": "D012",
        "patient_key": "P001",
        "reason": "Please evaluate worsening exertional dyspnea.",
        "urgency": "soon",
    })
    assert response.status_code == 201, response.text
    return response.json()["referral"]


def test_directory_is_case_aware_and_excludes_requester(client: TestClient):
    response = client.get("/referrals/directory", params={"doctor": "D011", "patient_key": "P001"})
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["provider"]["doctor_key"] == "D012"
    assert all(row["provider"]["doctor_key"] != "D011" for row in body["results"])
    assert body["results"][0]["reasons"]


def test_patient_handoff_is_hidden_until_acceptance_and_messages_work(client: TestClient):
    referral = create_referral(client)
    key = referral["referral_key"]

    before = client.get(f"/referrals/{key}", params={"viewer": "D012"}).json()
    assert before["patient_visible"] is False
    assert before["patient_handoff"] is None

    accepted = client.post(f"/referrals/{key}/status", json={
        "status": "accepted",
        "actor_doctor_key": "D012",
    })
    assert accepted.status_code == 200
    assert accepted.json()["patient_handoff"]["patient_display_label"] == "Synthetic Patient"
    assert accepted.json()["patient_handoff"]["symptoms"][0]["name"] == "dyspnea"

    sent = client.post(f"/referrals/{key}/messages", json={
        "sender_doctor_key": "D012",
        "text": "I can review the recent cardiac workup.",
    })
    assert sent.status_code == 201
    assert sent.json()["sender_doctor_key"] == "D012"

    invalid_completion = client.post(f"/referrals/{key}/status", json={
        "status": "completed",
        "actor_doctor_key": "D012",
    })
    assert invalid_completion.status_code == 422
    completed = client.post(f"/referrals/{key}/status", json={
        "status": "completed",
        "actor_doctor_key": "D012",
        "outcome": "Evaluation completed.",
    })
    assert completed.status_code == 200
    assert completed.json()["referral"]["status"] == "completed"


def test_referral_access_and_transition_permissions(client: TestClient):
    referral = create_referral(client)
    key = referral["referral_key"]
    assert client.get(f"/referrals/{key}", params={"viewer": "D013"}).status_code == 403
    assert client.post(f"/referrals/{key}/status", json={
        "status": "accepted",
        "actor_doctor_key": "D011",
    }).status_code == 403
    assert client.get("/referrals", params={"doctor": "D011"}).json()[0]["referral_key"] == key
