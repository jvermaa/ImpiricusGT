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
            age_group="45-54",
            state="GA",
            sex_for_clinical_context="female",
            preferred_language="English",
            primary_doctor_key="D011",
            allergy_status="none reported",
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
    payload = response.json()
    assert payload["referral"]["status"] == "pending_patient_consent"
    assert payload["consent"]["approve_url"]
    assert payload["consent"]["decline_url"]
    return payload


def patient_approves(client: TestClient, created: dict) -> None:
    approve_url = created["consent"]["approve_url"]
    path = approve_url.split("8000", 1)[-1] if "8000" in approve_url else approve_url
    if path.startswith("http"):
        from urllib.parse import urlparse
        path = urlparse(approve_url).path + "?" + urlparse(approve_url).query
    response = client.get(path)
    assert response.status_code == 200, response.text
    assert "approved" in response.text.lower()


def test_directory_is_case_aware_and_excludes_requester(client: TestClient):
    response = client.get("/referrals/directory", params={"doctor": "D011", "patient_key": "P001"})
    assert response.status_code == 200
    body = response.json()
    assert body["results"][0]["provider"]["doctor_key"] == "D012"
    assert all(row["provider"]["doctor_key"] != "D011" for row in body["results"])
    assert body["results"][0]["reasons"]


def test_patient_handoff_is_hidden_until_consent_and_messages_work(client: TestClient):
    created = create_referral(client)
    key = created["referral"]["referral_key"]

    before = client.get(f"/referrals/{key}", params={"viewer": "D012"}).json()
    assert before["referral"]["status"] == "pending_patient_consent"
    assert before["patient_visible"] is False
    assert before["patient_handoff"] is None

    # Specialist cannot accept before patient consent.
    assert client.post(f"/referrals/{key}/status", json={
        "status": "accepted",
        "actor_doctor_key": "D012",
    }).status_code == 409

    patient_approves(client, created)

    shared = client.get(f"/referrals/{key}", params={"viewer": "D012"}).json()
    assert shared["referral"]["status"] == "shared_with_specialist"
    assert shared["patient_visible"] is True
    assert shared["patient_handoff"]["patient_display_label"] == "Synthetic Patient"
    assert shared["patient_handoff"]["symptoms"] == ["dyspnea", "fatigue"]

    accepted = client.post(f"/referrals/{key}/status", json={
        "status": "accepted",
        "actor_doctor_key": "D012",
    })
    assert accepted.status_code == 200
    assert accepted.json()["referral"]["status"] == "accepted"

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


def test_patient_can_decline_referral_consent(client: TestClient):
    created = create_referral(client)
    key = created["referral"]["referral_key"]
    decline_url = created["consent"]["decline_url"]
    from urllib.parse import urlparse
    parsed = urlparse(decline_url)
    path = parsed.path + "?" + parsed.query
    response = client.get(path)
    assert response.status_code == 200
    assert "declined" in response.text.lower()
    detail = client.get(f"/referrals/{key}", params={"viewer": "D011"}).json()
    assert detail["referral"]["status"] == "patient_declined"
    # Reusing the link fails.
    assert "Already used" in client.get(path).text


def test_referral_access_and_transition_permissions(client: TestClient):
    created = create_referral(client)
    key = created["referral"]["referral_key"]
    assert client.get(f"/referrals/{key}", params={"viewer": "D013"}).status_code == 403
    assert client.post(f"/referrals/{key}/status", json={
        "status": "accepted",
        "actor_doctor_key": "D011",
    }).status_code == 409
    assert client.get("/referrals", params={"doctor": "D011"}).json()[0]["referral_key"] == key
    # Referring doctor can cancel while waiting on patient consent.
    cancelled = client.post(f"/referrals/{key}/status", json={
        "status": "cancelled",
        "actor_doctor_key": "D011",
    })
    assert cancelled.status_code == 200
    assert cancelled.json()["referral"]["status"] == "cancelled"