"""Profile card, settings, and the case-exchange filter that reads them."""
import os
from datetime import datetime

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from checks import run_checks
from database import Base, get_db
from main import app
from models import CaseMatch, ConsultMessage, Diagnosis, Doctor, Patient


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


def _start_consult(client: TestClient, doctor: str, peer: str, text: str) -> tuple[dict, dict]:
    opened = client.post("/consults", params={"doctor": doctor}, json={"peer_doctor_key": peer})
    assert opened.status_code == 201, opened.text
    sent = client.post(
        f"/consults/{opened.json()['thread_id']}/messages",
        params={"doctor": doctor},
        json={"text": text},
    )
    assert sent.status_code == 201, sent.text
    return opened.json(), sent.json()


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

    _start_consult(client, "D011", "D012", "De-identified consult about heart failure ranges.")

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
    assert body["patient_count"] == 2
    assert body["consult_thread_count"] == 1
    assert body["referrals_in"] == 1
    assert body["referrals_out"] == 1
    assert body["is_self"] is True
    assert body["display_name"] == "Dr. Aisha Ali"
    assert body["specialty_title"] == "Primary Care Physician"
    assert "professional_email" not in body
    assert "npi" not in body
    assert "P001" not in profile.text
    assert "P002" not in profile.text
    assert "Synthetic P001" not in profile.text

    outgoing = client.get("/referrals", params={"doctor": "D011", "direction": "out"})
    assert [row["to_doctor_key"] for row in outgoing.json()] == ["D012"]
    incoming_rows = client.get(
        "/referrals",
        params={"doctor": "D011", "direction": "in", "with": "D012"},
    )
    assert [row["from_doctor_key"] for row in incoming_rows.json()] == ["D012"]


def test_cannot_edit_another_doctors_settings(client: TestClient):
    denied = client.patch(
        "/doctors/D012/settings",
        params={"viewer": "D011"},
        json={"accepts_peer_consults": False},
    )
    assert denied.status_code == 403

    unchanged = client.get("/doctors/D012/profile", params={"viewer": "D012"})
    assert unchanged.json()["accepts_peer_consults"] is True

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
    assert again.json()["accepts_peer_consults"] is False
    assert again.json()["can_message"] is False


def test_profile_hides_private_fields_and_reports_the_mutual_thread(client: TestClient):
    directory = client.get("/doctors")
    assert directory.status_code == 200
    for row in directory.json():
        assert "professional_email" not in row
        assert "professional_phone" not in row
        assert "npi" not in row
        assert "license_number" not in row
        assert "patient_count" not in row

    own = client.get("/doctors/D011/profile", params={"viewer": "D011"})
    assert own.json()["is_self"] is True
    assert own.json()["can_message"] is False
    assert "patient_count" in own.json()

    stranger = client.get("/doctors/D013/profile", params={"viewer": "D011"})
    assert stranger.status_code == 200
    assert "professional_email" not in stranger.json()
    assert "patient_count" not in stranger.json()
    assert stranger.json()["can_message"] is True
    assert "mutual_thread_id" not in stranger.json()

    _start_consult(client, "D011", "D013", "Opening a consult thread.")

    peer = client.get("/doctors/D013/profile", params={"viewer": "D011"})
    body = peer.json()
    assert body["mutual_thread_id"]
    assert body["mutual_last_message"] == "Opening a consult thread."
    assert body["consult_thread_count"] == 1
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


def test_consults_and_referral_suggestions_follow_the_accepts_flag(client: TestClient):
    opened, _sent = _start_consult(client, "D011", "D012", "Starting a consult thread.")
    thread_id = opened["thread_id"]

    listed = client.get("/consults", params={"doctor": "D011"})
    assert any(row["doctor_key"] == "D012" for row in listed.json())
    suggested = client.get("/referrals/directory", params={"doctor": "D011", "patient_key": "P001"})
    assert any(row["provider"]["doctor_key"] == "D012" for row in suggested.json()["results"])

    off = client.patch(
        "/doctors/D012/settings",
        params={"viewer": "D012"},
        json={"accepts_peer_consults": False},
    )
    assert off.status_code == 200
    assert off.json()["accepts_peer_consults"] is False

    hidden = client.get("/consults", params={"doctor": "D011"})
    assert all(row["doctor_key"] != "D012" for row in hidden.json())
    history = client.get(f"/consults/{thread_id}/messages", params={"doctor": "D011"})
    assert history.status_code == 200
    assert history.json()[0]["text"] == "Starting a consult thread."
    blocked = client.post(
        f"/consults/{thread_id}/messages",
        params={"doctor": "D011"},
        json={"text": "This should stay read-only."},
    )
    assert blocked.status_code == 403
    suggestions = client.get("/referrals/directory", params={"doctor": "D011", "patient_key": "P001"})
    assert all(row["provider"]["doctor_key"] != "D012" for row in suggestions.json()["results"])

    fresh = client.post("/consults", params={"doctor": "D011"}, json={"peer_doctor_key": "D013"})
    assert fresh.status_code == 201
    client.post(
        f"/consults/{fresh.json()['thread_id']}/messages",
        params={"doctor": "D011"},
        json={"text": "Should not open."},
    )
    client.patch(
        "/doctors/D013/settings",
        params={"viewer": "D013"},
        json={"accepts_peer_consults": False},
    )
    # The thread above was created while D013 still accepted consults. Close it, then prove a new pair is rejected.
    denied = client.post("/consults", params={"doctor": "D012"}, json={"peer_doctor_key": "D013"})
    assert denied.status_code == 403
    assert "not accepting peer consults" in denied.json()["detail"]

    on = client.patch(
        "/doctors/D012/settings",
        params={"viewer": "D012"},
        json={"accepts_peer_consults": True},
    )
    assert on.status_code == 200
    restored = client.get("/consults", params={"doctor": "D011"})
    assert any(row["doctor_key"] == "D012" for row in restored.json())
    back = client.get("/referrals/directory", params={"doctor": "D011", "patient_key": "P001"})
    assert any(row["provider"]["doctor_key"] == "D012" for row in back.json()["results"])
    assert fresh.status_code == 201


def test_bio_is_plain_text_and_only_the_doctor_can_edit_it(client: TestClient):
    empty = client.get("/doctors/D011/profile", params={"viewer": "D011"})
    assert empty.json()["bio"] is None

    saved = client.patch(
        "/doctors/D011/profile",
        params={"viewer": "D011"},
        json={"bio": "  I see migraine and concussion follow-up.  "},
    )
    assert saved.status_code == 200
    assert saved.json() == {"bio": "I see migraine and concussion follow-up."}
    again = client.get("/doctors/D012/profile", params={"viewer": "D013"})
    assert again.json()["bio"] is None
    visible = client.get("/doctors/D011/profile", params={"viewer": "D012"})
    assert visible.json()["bio"] == "I see migraine and concussion follow-up."

    denied = client.patch(
        "/doctors/D011/profile",
        params={"viewer": "D012"},
        json={"bio": "Not my bio."},
    )
    assert denied.status_code == 403

    too_long = client.patch(
        "/doctors/D011/profile",
        params={"viewer": "D011"},
        json={"bio": "x" * 281},
    )
    assert too_long.status_code == 422

    markup = client.patch(
        "/doctors/D011/profile",
        params={"viewer": "D011"},
        json={"bio": "<b>hello</b>"},
    )
    assert markup.status_code == 422

    cleared = client.patch(
        "/doctors/D011/profile",
        params={"viewer": "D011"},
        json={"bio": "   "},
    )
    assert cleared.status_code == 200
    assert cleared.json()["bio"] is None


def test_outsider_cannot_read_or_send_on_a_thread(client: TestClient):
    opened, _sent = _start_consult(client, "D011", "D012", "Peer consult between the two participants.")
    thread_id = opened["thread_id"]
    hidden = client.get(f"/consults/{thread_id}/messages", params={"doctor": "D013"})
    assert hidden.status_code == 403
    outsider = client.post(
        f"/consults/{thread_id}/messages",
        params={"doctor": "D013"},
        json={"text": "I am not on this thread."},
    )
    assert outsider.status_code == 403
    visible = client.get(f"/consults/{thread_id}/messages", params={"doctor": "D012"})
    assert visible.status_code == 200
    assert visible.json()[0]["sender_doctor_key"] == "D011"


def test_new_threads_require_both_doctors_to_accept_consults(client: TestClient):
    client.patch(
        "/doctors/D013/settings",
        params={"viewer": "D013"},
        json={"accepts_peer_consults": False},
    )
    denied = client.post("/consults", params={"doctor": "D011"}, json={"peer_doctor_key": "D013"})
    assert denied.status_code == 403
    assert "not accepting peer consults" in denied.json()["detail"]
    client.patch(
        "/doctors/D013/settings",
        params={"viewer": "D013"},
        json={"accepts_peer_consults": True},
    )
    restored = client.post("/consults", params={"doctor": "D011"}, json={"peer_doctor_key": "D013"})
    assert restored.status_code == 201


def test_check_db_rejects_outside_senders_and_consults_off(client: TestClient):
    opened, _sent = _start_consult(client, "D011", "D012", "Stored consult for the integrity check.")
    thread_id = opened["thread_id"]
    session_factory = app.dependency_overrides[get_db]
    generator = session_factory()
    db = next(generator)
    try:
        db.add(
            ConsultMessage(
                thread_id=thread_id,
                sender_doctor_key="D013",
                text="This sender is not on the thread.",
                created_at=datetime.utcnow(),
            )
        )
        db.commit()
        sender_errors, _warnings = run_checks(db)
    finally:
        generator.close()
    assert any("sender is outside" in error for error in sender_errors)

    client.patch(
        "/doctors/D012/settings",
        params={"viewer": "D012"},
        json={"accepts_peer_consults": False},
    )
    generator = session_factory()
    db = next(generator)
    try:
        closed_errors, _warnings = run_checks(db)
    finally:
        generator.close()
    assert any("consults off" in error for error in closed_errors)
