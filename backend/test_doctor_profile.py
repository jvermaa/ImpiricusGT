"""Profile card, settings, and the case-exchange filter that reads them."""
import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app
from models import CaseMatch, Diagnosis, Doctor, Patient


def _doctor(key: str, name: str, specialty: str, *, exchange: bool, email: str) -> Doctor:
    return Doctor(
        doctor_key=key,
        display_name=name,
        credentials="MD",
        specialty=specialty,
        subspecialty_focus="Heart failure" if specialty == "Cardiology" else specialty,
        practice_type="community",
        state="GA",
        years_in_practice=8,
        languages_json='["English"]',
        case_exchange_opt_in=exchange,
        accepts_peer_consults=True,
        patient_message_review_required=True,
        professional_email=email,
        professional_phone=None,
        license_number=None,
        npi=None,
        organization="Synthetic Clinic",
    )


def _patient(key: str, doctor_key: str, sharing: str) -> Patient:
    return Patient(
        patient_key=key,
        name=f"Synthetic {key}",
        age_group="45-54",
        state="GA",
        sex_for_clinical_context="female",
        preferred_language="English",
        primary_doctor_key=doctor_key,
        allergy_status="none reported",
        symptoms_json='["dyspnea"]',
        tobacco_use="never",
        surgery_history="not recorded",
        family_history="not recorded",
        pregnancy_status="not recorded",
        portal_access=False,
        email_contact_available=False,
        messaging_preference="unavailable",
        patient_education_language="English",
        sharing_preference_for_peer_cases=sharing,
        clinical_trial_outreach_preference="not documented",
        source="synthetic test fixture",
    )


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
        db.add(_doctor("D011", "Dr. Aisha Ali", "Primary Care", exchange=True, email="aisha@example.invalid"))
        db.add(_doctor("D012", "Dr. Jordan Morgan", "Cardiology", exchange=True, email="jordan@example.invalid"))
        db.add(_doctor("D013", "Dr. Leena Morris", "Neurology", exchange=False, email="leena@example.invalid"))
        db.add(_patient("P001", "D011", "not documented"))
        db.add(_patient("P002", "D012", "de-identified case only"))
        db.add(Diagnosis(
            patient_key="P002",
            label="Heart failure",
            code_system="ICD-10-CM",
            code="I50.9",
            status="active",
            first_recorded_year=2025,
        ))
        db.add(CaseMatch(
            query_patient_key="P001",
            candidate_patient_key="P002",
            query_doctor_key="D011",
            candidate_doctor_key="D012",
            matching_feature="diagnosis",
            review_status="unreviewed",
            score=0.8,
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


def test_profile_stats_match_the_database(client: TestClient):
    created = client.post("/patients", json={
        "name": "Second panel patient",
        "age_group": "55-64",
        "state": "GA",
        "sex_for_clinical_context": "male",
        "preferred_language": "English",
        "primary_doctor_key": "D011",
    })
    assert created.status_code == 201

    message = client.post("/consults/messages", json={
        "doctor_key": "D011",
        "peer_doctor_key": "D012",
        "text": "De-identified consult about heart failure ranges.",
    })
    assert message.status_code == 201

    referral = client.post("/referrals", json={
        "from_doctor_key": "D011",
        "to_doctor_key": "D012",
        "patient_key": "P001",
        "reason": "Heart failure outside primary care scope.",
        "urgency": "routine",
    })
    assert referral.status_code == 201

    incoming = client.post("/referrals", json={
        "from_doctor_key": "D012",
        "to_doctor_key": "D011",
        "patient_key": "P002",
        "reason": "Needs longitudinal primary care follow-up.",
        "urgency": "soon",
    })
    assert incoming.status_code == 201

    profile = client.get("/doctors/D011/profile", params={"viewer": "D011"})
    assert profile.status_code == 200
    body = profile.json()
    assert body["stats"] == {
        "patient_count": 2,
        "peer_consult_threads": 1,
        "referrals_received": 1,
        "referrals_sent": 1,
        "case_polls_answered": 0,
    }
    assert body["verification"] == "demo"
    assert body["is_self"] is True
    assert body["identity"]["display_name"] == "Dr. Aisha Ali"
    assert body["identity"]["specialty_title"] == "Primary Care Physician"
    assert "P001" not in profile.text
    assert "P002" not in profile.text
    assert "Synthetic P001" not in profile.text


def test_cannot_edit_another_doctors_settings(client: TestClient):
    denied = client.patch(
        "/doctors/D012/settings",
        params={"viewer": "D011"},
        json={"accepts_peer_consults": False},
    )
    assert denied.status_code == 403

    unchanged = client.get("/doctors/D012/profile", params={"viewer": "D012"})
    assert unchanged.json()["settings"]["accepts_peer_consults"] is True

    updated = client.patch(
        "/doctors/D011/settings",
        params={"viewer": "D011"},
        json={"accepts_peer_consults": False, "case_exchange_opt_in": True},
    )
    assert updated.status_code == 200
    assert updated.json() == {
        "accepts_peer_consults": False,
        "case_exchange_opt_in": True,
    }
    again = client.get("/doctors/D011/profile", params={"viewer": "D011"})
    assert again.json()["settings"]["accepts_peer_consults"] is False


def test_email_hidden_until_there_is_a_consult_thread(client: TestClient):
    stranger = client.get("/doctors/D013/profile", params={"viewer": "D011"})
    assert stranger.status_code == 200
    assert "professional_email" not in stranger.json()

    own = client.get("/doctors/D011/profile", params={"viewer": "D011"})
    assert own.json()["professional_email"] == "aisha@example.invalid"

    sent = client.post("/consults/messages", json={
        "doctor_key": "D011",
        "peer_doctor_key": "D013",
        "text": "Opening a consult thread.",
    })
    assert sent.status_code == 201

    peer = client.get("/doctors/D013/profile", params={"viewer": "D011"})
    body = peer.json()
    assert body["has_consult_thread"] is True
    assert body["professional_email"] == "leena@example.invalid"
    assert body["is_self"] is False


def test_opting_out_of_case_exchange_hides_matches_without_deleting_them(client: TestClient):
    before = client.get("/patients/P001/similar", params={"doctor": "D011"})
    assert before.status_code == 200
    assert [row["patient_key"] for row in before.json()] == ["P002"]

    off = client.patch(
        "/doctors/D012/settings",
        params={"viewer": "D012"},
        json={"case_exchange_opt_in": False},
    )
    assert off.status_code == 200

    hidden = client.get("/patients/P001/similar", params={"doctor": "D011"})
    assert hidden.json() == []

    session_factory = app.dependency_overrides[get_db]
    generator = session_factory()
    db = next(generator)
    try:
        kept = db.scalar(
            select(CaseMatch).where(
                CaseMatch.query_patient_key == "P001",
                CaseMatch.candidate_patient_key == "P002",
            )
        )
        assert kept is not None
    finally:
        generator.close()

    on = client.patch(
        "/doctors/D012/settings",
        params={"viewer": "D012"},
        json={"case_exchange_opt_in": True},
    )
    assert on.status_code == 200
    restored = client.get("/patients/P001/similar", params={"doctor": "D011"})
    assert [row["patient_key"] for row in restored.json()] == ["P002"]
