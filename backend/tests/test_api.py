"""Run: PCX_OFFLINE=1 pytest -q"""
import os
import sqlite3
import tempfile

os.environ["PCX_DATA_DIR"] = tempfile.mkdtemp(prefix="pcx_test_")
os.environ["PCX_OFFLINE"] = "1"
os.environ["ANTHROPIC_API_KEY"] = ""  # tests exercise the rule-based fallbacks

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import config, db, deid  # noqa: E402
from app.main import app  # noqa: E402
from scripts import seed  # noqa: E402

RAW = ("Mrs. Jane Doe, 52 year old female seen at Emory Clinic on 03/14/2026, MRN 44821907, "
       "phone 404-555-0199, jane.doe@example.com. Atopic dermatitis well controlled on dupilumab "
       "for 5 months, now new heel pain and knee stiffness in the morning. Enthesitis on exam, "
       "RF and CCP negative. Temp 99 F. Is this related to the biologic?")


@pytest.fixture(scope="module")
def client():
    seed.main()
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def derm(client):
    return next(h for h in db.list_hcps(300) if h["specialty"] == "Dermatology")


# ---------- De-identification ----------

def test_deid_removes_identifiers_and_keeps_clinical_content():
    out = deid.deidentify(RAW, use_llm=False)
    t = out["redacted_text"]
    for leaked in ["Jane", "Doe", "Emory", "03/14/2026", "44821907", "404-555-0199", "jane.doe", "52 year"]:
        assert leaked not in t, leaked
    for kept in ["dupilumab", "Enthesitis", "RF and CCP negative", "Temp 99 F"]:
        assert kept in t, kept
    assert out["age_band"] == "50s"


def test_age_over_89_becomes_90_plus():
    out = deid.deidentify("93 year old man with new confusion and hyponatremia.", use_llm=False)
    assert out["age_band"] == "90+"
    assert "93" not in out["redacted_text"]
    assert any("90" in w for w in out["warnings"])


def test_rare_case_warning():
    out = deid.deidentify("40 yo woman, possibly the only known case of this syndrome in the region.", use_llm=False)
    assert any("rare" in w.lower() for w in out["warnings"])


def test_lab_values_not_treated_as_ages():
    out = deid.deidentify("CK 8000, fever 101 F, A1c 7.2, 45M with weakness.", use_llm=False)
    assert "CK 8000" in out["redacted_text"] and "101 F" in out["redacted_text"]
    assert out["age_band"] == "40s"


# ---------- Case lifecycle ----------

def test_create_case_rejects_unconfirmed(client, derm):
    r = client.post("/cases", json={"author_hcp_id": derm["id"], "redacted_text": "x" * 20,
                                    "confirmed_deidentified": False})
    assert r.status_code == 400


def test_create_case_rejects_identifiers_added_after_review(client, derm):
    r = client.post("/cases", json={"author_hcp_id": derm["id"], "confirmed_deidentified": True,
                                    "redacted_text": "Patient seen 04/02/2026, call 404-555-0101 re: rash."})
    assert r.status_code == 422
    assert "DATE" in r.json()["detail"]["categories"]


def test_raw_text_is_never_stored(client, derm):
    d = client.post("/cases/deidentify", json={"raw_text": RAW}).json()
    r = client.post("/cases", json={"author_hcp_id": derm["id"], "redacted_text": d["redacted_text"],
                                    "structured": d["structured_preview"], "consent_to_index": False,
                                    "confirmed_deidentified": True})
    assert r.status_code == 201
    with sqlite3.connect(config.SQLITE_PATH) as c:
        dump = "\n".join(str(row) for row in c.execute("SELECT * FROM cases"))
    for secret in ["Jane", "Emory", "44821907", "404-555-0199"]:
        assert secret not in dump


def test_match_finds_the_right_diagnosis_and_expert(client, derm):
    d = client.post("/cases/deidentify", json={"raw_text": RAW}).json()
    r = client.post("/cases", json={"author_hcp_id": derm["id"], "redacted_text": d["redacted_text"],
                                    "structured": d["structured_preview"], "consent_to_index": True,
                                    "confirmed_deidentified": True})
    m = r.json()["match"]
    assert m["diagnoses_seen"][0]["diagnosis"].startswith("Dupilumab-associated")
    assert all(p["hcp_id"] != derm["id"] for p in m["peers"])           # never match yourself
    assert "Resolved" in m["peers"][0]["reasons"][0]                     # proven expert ranks first
    assert any(p["specialty"] == "Rheumatology" for p in m["peers"])     # cross-specialty view
    assert all(s["similarity"] >= config.SIMILAR_CASE_MIN_SIM for s in m["similar_cases"])


def test_full_loop_resolve_and_network_learns(client, derm):
    """A new kind of case: no match at first; after resolution it teaches the network."""
    novel = ("[AGE: 30s] female with recurrent episodes of angioedema of the lips and hands, normal C4, "
             "no urticaria, not on ACE inhibitor, antihistamines ineffective. What should I test next?")
    s = client.post("/cases/deidentify", json={"raw_text": novel}).json()["structured_preview"]
    before = client.post("/match", json={"structured": s, "include_evidence": False}).json()
    assert not any("angioedema" in (d["diagnosis"] or "").lower() for d in before["diagnoses_seen"])

    case = client.post("/cases", json={"author_hcp_id": derm["id"], "redacted_text": novel, "structured": s,
                                       "consent_to_index": True, "confirmed_deidentified": True}).json()["case"]
    peer = next(h for h in db.list_hcps(300) if h["specialty"] == "Internal Medicine")
    resp = client.post(f"/cases/{case['id']}/responses", json={"hcp_id": peer["id"],
                       "body": "Check C1-INH function; consider HAE with normal C1-INH."})
    assert resp.status_code == 201
    res = client.post(f"/cases/{case['id']}/resolve",
                      json={"final_diagnosis": "Hereditary angioedema with normal C1-INH",
                            "resolved_by_hcp_id": peer["id"]}).json()
    assert res["indexed_for_future_matching"] is True

    other = next(h for h in db.list_hcps(300) if h["specialty"] == "Rheumatology")
    after = client.post("/match", json={"author_hcp_id": other["id"], "structured": s,
                                        "include_evidence": False}).json()
    assert after["diagnoses_seen"][0]["diagnosis"] == "Hereditary angioedema with normal C1-INH"
    assert after["peers"][0]["hcp_id"] == peer["id"]


def test_unconsented_case_is_not_indexed(client, derm):
    text = "[AGE: 60s] male with unexplained eosinophilia and a pruritic rash. Any thoughts?"
    case = client.post("/cases", json={"author_hcp_id": derm["id"], "redacted_text": text,
                                       "consent_to_index": False, "confirmed_deidentified": True}).json()["case"]
    res = client.post(f"/cases/{case['id']}/resolve", json={"final_diagnosis": "Test diagnosis X"}).json()
    assert res["indexed_for_future_matching"] is False


def test_reply_with_identifiers_is_blocked(client, derm):
    text = "[AGE: 40s] female with chronic cough and a normal chest X-ray. Ideas?"
    case = client.post("/cases", json={"author_hcp_id": derm["id"], "redacted_text": text,
                                       "confirmed_deidentified": True}).json()["case"]
    peer = next(h for h in db.list_hcps(300) if h["specialty"] == "Pulmonology")
    r = client.post(f"/cases/{case['id']}/responses", json={"hcp_id": peer["id"],
                    "body": "I saw Mr. John Smith with the same thing, call me at 404-555-0123."})
    assert r.status_code == 422


# ---------- Insights ----------

def test_insights_are_aggregate_only_with_k_floor(client):
    ins = client.get("/insights").json()
    assert ins["k_anonymity_floor"] == config.K_MIN
    assert all(n >= config.K_MIN for n in ins["resolved_cases_by_specialty"].values())
    assert all(d["cases"] >= config.K_MIN for d in ins["top_diagnoses_behind_hard_cases"])
    blob = str(ins)
    assert "case_" not in blob and "hcp_" not in blob      # no case or HCP identifiers leak
    assert ins["suppressed_groups"] >= 1                     # the 1-case angioedema group is hidden


# ---------- Patient page: "Find similar cases" (diagram step 1) ----------

def _demo_patient(client, name):
    return next(p for p in client.get("/demo").json()["patients"] if p["display_name"] == name)


def test_find_similar_never_leaks_patient_name(client):
    for p in client.get("/demo").json()["patients"]:
        r = client.post(f"/patients/{p['id']}/find-similar", json={"include_evidence": False}).json()
        for tok in p["display_name"].split():
            assert tok not in r["deidentified"]["redacted_text"]
            assert tok not in str(r["match"])


def test_find_similar_returns_diagnosis_treatment_and_outcome(client):
    p = _demo_patient(client, "Maria Lopez")
    m = client.post(f"/patients/{p['id']}/find-similar", json={"include_evidence": False}).json()["match"]
    top = m["diagnoses_seen"][0]
    assert top["diagnosis"].startswith("Dupilumab-associated")
    assert top["treatments"] and "JAK" in top["treatments"][0]
    assert m["similar_cases"][0]["outcome"]
    assert all(pe["hcp_id"] != "hcp_demo" for pe in m["peers"])


def test_find_similar_accepts_detailed_profile_and_returns_case_cards(client):
    p = _demo_patient(client, "Maria Lopez")
    profile = {
        "age_band": "50s",
        "sex": "female",
        "symptoms": [
            {"name": "heel pain", "duration": "2 months", "frequency": "daily",
             "onset": "gradual", "aggravating_factors": ["walking"]},
            {"name": "morning knee stiffness", "duration": "3 weeks"},
        ],
        "past_medical_history": ["atopic dermatitis"],
        "family_medical_history": ["no relevant history reported"],
        "current_medications": ["dupilumab"],
        "social_history": ["does not smoke"],
        "lab_results": ["RF and CCP negative"],
        "pregnancy_status": "not pregnant",
        "immune_status": "not immunocompromised",
    }
    response = client.post(
        f"/patients/{p['id']}/find-similar",
        json={"include_evidence": False, "structured_profile": profile},
    )
    assert response.status_code == 200
    payload = response.json()
    result = payload["match"]["similar_cases"][0]
    assert result["summary"]["age_band"]
    assert len(result["summary"]["symptoms"]) <= 3
    assert payload["deidentified"]["structured_preview"]["lab_results"] == ["RF and CCP negative"]
    assert "lab_results" in result["details"]
    assert result["score_type"] == "vector_similarity_not_diagnostic_probability"


def test_novel_patient_gets_no_false_diagnosis(client):
    # Earlier in this run test_full_loop resolved an angioedema case, so the network may
    # legitimately know this pattern now. Either way it must never show an unrelated diagnosis.
    p = _demo_patient(client, "Elena Petrova")
    m = client.post(f"/patients/{p['id']}/find-similar", json={"include_evidence": False}).json()["match"]
    assert all("angioedema" in d["diagnosis"].lower() for d in m["diagnoses_seen"])
    if not m["diagnoses_seen"]:
        assert m["network_note"]
    assert m["peers"]


def test_scrub_known_catches_partial_names():
    text, n = deid.scrub_known("Maria reports pain. Ms. Lopez also notes stiffness.", ["Maria Lopez"])
    assert "Maria" not in text and "Lopez" not in text and n == 2


def test_resolve_stores_treatment_and_blocks_identifiers(client, derm):
    text = "[AGE: 50s] male with chronic hiccups for 3 weeks, normal imaging. Ideas?"
    case = client.post("/cases", json={"author_hcp_id": derm["id"], "redacted_text": text,
                                       "confirmed_deidentified": True}).json()["case"]
    bad = client.post(f"/cases/{case['id']}/resolve", json={"final_diagnosis": "X",
                      "treatment_used": "Called Mr. Smith at 404-555-0100"})
    assert bad.status_code == 422
    ok = client.post(f"/cases/{case['id']}/resolve", json={"final_diagnosis": "Phrenic nerve irritation",
                     "treatment_used": "Baclofen trial", "outcome": "Resolved"}).json()
    assert ok["case"]["treatment_used"] == "Baclofen trial"
