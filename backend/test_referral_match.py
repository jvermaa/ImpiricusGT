"""Referral suggestions stay inside the real candidate list, with a rules fallback."""

import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import referral_match
from database import Base, get_db
from main import app
from models import Diagnosis, Doctor, Patient


def _doctor(key: str, name: str, specialty: str, accepts: bool, state: str = "GA") -> Doctor:
    return Doctor(
        doctor_key=key,
        display_name=name,
        credentials="MD",
        specialty=specialty,
        subspecialty_focus="Heart failure" if specialty == "Cardiology" else specialty,
        practice_type="community",
        state=state,
        years_in_practice=12,
        languages_json='["English", "Spanish"]',
        case_exchange_opt_in=True,
        accepts_peer_consults=accepts,
        patient_message_review_required=True,
        professional_email=f"{key.lower()}@example.invalid",
        professional_phone=None,
        license_number=None,
        npi=None,
        organization="Synthetic Clinic",
    )


@pytest.fixture()
def client():
    referral_match._CACHE.clear()
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
                _doctor("D001", "Dr. Primary", "Cardiology", True),
                _doctor("D002", "Dr. Heart", "Cardiology", True),
                _doctor("D003", "Dr. Skin", "Dermatology", True, state="AL"),
                _doctor("D004", "Dr. Closed", "Cardiology", False),
            ]
        )
        db.add(
            Patient(
                patient_key="P001",
                name="Synthetic Patient",
                age_group="50-59",
                state="GA",
                sex_for_clinical_context="female",
                preferred_language="Spanish",
                primary_doctor_key="D001",
                allergy_status="none reported",
                symptoms_json="[]",
                tobacco_use="never",
                surgery_history="not recorded",
                family_history="not recorded",
                pregnancy_status="not recorded",
                portal_access=True,
                contact_email="harisamser27@gmail.com",
                email_contact_available=True,
                messaging_preference="portal",
                patient_education_language="Spanish",
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
                first_recorded_year=2024,
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
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    referral_match._CACHE.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_suggestions_drop_invented_keys_and_fall_back(client, monkeypatch):
    def _bad(_prompt: str) -> str:
        return '[{"doctor_key": "D004", "reason": "closed panel"}, {"doctor_key": "D999", "reason": "not real"}]'

    monkeypatch.setattr(referral_match, "generate_text", _bad)
    response = client.get(
        "/patients/P001/referral-suggestions",
        params={"doctor": "D001", "limit": 3},
    )
    assert response.status_code == 200, response.text
    rows = response.json()
    keys = {row["doctor_key"] for row in rows}
    assert "D001" not in keys
    assert "D004" not in keys
    assert "D999" not in keys
    assert rows[0]["doctor_key"] == "D002"
    assert rows[0]["ranked_by"] == "rules"
    assert all(row["doctor_key"] in {"D002", "D003"} for row in rows)


def test_suggestions_use_gemini_only_for_real_candidates(client, monkeypatch):
    monkeypatch.setattr(
        referral_match,
        "generate_text",
        lambda _prompt: '[{"doctor_key": "D003", "reason": "Dermatology is not the best cardiac fit"}]',
    )
    response = client.get("/patients/P001/referral-suggestions", params={"doctor": "D001"})
    rows = response.json()
    assert rows[0]["doctor_key"] == "D003"
    assert rows[0]["ranked_by"] == "gemini"
    assert "D001" not in {row["doctor_key"] for row in rows}


def test_other_doctor_cannot_ask_for_suggestions(client, monkeypatch):
    monkeypatch.setattr(referral_match, "generate_text", lambda _prompt: None)
    response = client.get("/patients/P001/referral-suggestions", params={"doctor": "D002"})
    assert response.status_code == 403


def test_gemini_outage_uses_rules(client, monkeypatch):
    def _boom(_prompt: str) -> str:
        raise RuntimeError("gemini down")

    monkeypatch.setattr(referral_match, "generate_text", _boom)
    response = client.get("/patients/P001/referral-suggestions", params={"doctor": "D001"})
    assert response.status_code == 200
    assert response.json()[0]["ranked_by"] == "rules"
