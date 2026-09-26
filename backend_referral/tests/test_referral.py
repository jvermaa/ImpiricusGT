"""Run: PCX_OFFLINE=1 python -m pytest -q"""
import os
import tempfile

os.environ.setdefault("PCX_DATA_DIR", tempfile.mkdtemp(prefix="pcx_test_"))
os.environ["PCX_OFFLINE"] = "1"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ.setdefault("PCX_DEMO", "1")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.referrals import directory  # noqa: E402
from app.referrals.taxonomy import ROLES, SPECIALTIES  # noqa: E402
from scripts import seed  # noqa: E402

QUESTIONS = {row[0]: row[5] for row in seed.DEMO_PATIENTS}


@pytest.fixture(scope="module")
def client():
    seed.main()
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def patients(client):
    return {p["display_name"]: p for p in client.get("/demo").json()["patients"]}


def _dir(client, **params):
    r = client.get("/referrals/directory", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _ids(d):
    return [r["provider"]["id"] for r in d["results"]]


# ---------- fixture ----------

def test_fixture_loads_and_matches_taxonomy():
    providers = directory.load_directory()
    assert len(providers) == 15
    assert all(p["specialty"] in SPECIALTIES and p["role"] in ROLES for p in providers.values())


# ---------- filters ----------

def test_specialty_filter(client):
    d = _dir(client, specialty="Rheumatology")
    assert d["total"] == 4
    assert {r["provider"]["specialty"] for r in d["results"]} == {"Rheumatology"}


def test_multiple_specialties_and_role(client):
    d = _dir(client, specialty=["Dermatology", "Oncology"], role="nurse")
    assert set(_ids(d)) == {"ref_005", "ref_009"}


def test_accepting_filter(client):
    assert "ref_007" not in _ids(_dir(client))
    assert "ref_007" in _ids(_dir(client, accepting=False))


def test_distance_filter_respects_telehealth(client):
    assert "ref_015" not in _ids(_dir(client, max_distance=25, include_telehealth=False))
    assert "ref_015" in _ids(_dir(client, max_distance=25, include_telehealth=True))
    # non-telehealth providers beyond the limit are always dropped
    near = _dir(client, max_distance=3, include_telehealth=False)
    assert all(r["distance_miles"] <= 3 for r in near["results"])


def test_focus_and_language_filters(client):
    assert _ids(_dir(client, focus="celiac")) == ["ref_006"]
    assert _ids(_dir(client, language="spanish")) == ["ref_013"]


def test_sort_by_distance_and_determinism(client):
    d = _dir(client, sort="distance")
    dists = [r["distance_miles"] for r in d["results"]]
    assert dists == sorted(dists)
    assert d == _dir(client, sort="distance")          # identical every time = repeatable demo
    assert _dir(client) == _dir(client)


def test_every_response_is_labelled_hardcoded(client, patients):
    assert _dir(client)["proximity_source"] == "hardcoded"
    assert _dir(client, patient_id=patients["Maria Lopez"]["id"])["proximity_source"] == "hardcoded"


def test_distance_bands(client):
    by_id = {r["provider"]["id"]: r for r in _dir(client, accepting=False)["results"]}
    assert by_id["ref_014"]["distance_band"] == "nearby"      # 1.8 mi
    assert by_id["ref_004"]["distance_band"] == "in_area"     # 6.1 mi
    assert by_id["ref_007"]["distance_band"] == "regional"    # 19.3 mi
    assert by_id["ref_015"]["distance_band"] == "far"         # 248 mi


def test_unknown_values_are_rejected(client):
    r = client.get("/referrals/directory", params={"specialty": "Cardiology"})
    assert r.status_code == 422 and "Rheumatology" in str(r.json())
    assert client.get("/referrals/directory", params={"role": "surgeon"}).status_code == 422


def test_list_hides_street_address_detail_shows_it(client):
    d = _dir(client)
    assert "address" not in str(d["results"][0]["provider"]["practice"])
    detail = client.get("/referrals/providers/ref_001").json()
    assert detail["practice"]["address"]["line1"]


def test_facets(client):
    f = client.get("/referrals/specialties").json()
    counts = {s["name"]: s["count"] for s in f["specialties"]}
    assert counts["Rheumatology"] == 4 and counts["Gastroenterology"] == 1   # ref_007 not accepting
    assert client.get("/referrals/specialties", params={"accepting": False}).json()["specialties"]


# ---------- case-aware ranking ----------

def _top(client, patients, name, type_):
    return _dir(client, patient_id=patients[name]["id"], type=type_, question=QUESTIONS[name])


def test_case_aware_suggests_specialties_and_ranks_by_evidence(client, patients):
    d = _top(client, patients, "Maria Lopez", "referral")
    assert d["applied_filters"]["suggested_specialties"][0] == "Rheumatology"   # not the requester's own
    assert _ids(d)[0] == "ref_001"
    assert "enthesitis" in d["results"][0]["score_breakdown"]["focus_matches"]


def test_neuromuscular_case_goes_to_neurologist(client, patients):
    assert _ids(_top(client, patients, "James Carter", "referral"))[0] == "ref_012"


def test_drug_question_brings_in_pharmacist_for_advice_only(client, patients):
    advice = _top(client, patients, "Robert Nguyen", "advice")
    referral = _top(client, patients, "Robert Nguyen", "referral")
    assert _ids(advice)[0] == "ref_014"
    assert "Clinical Pharmacy" not in referral["applied_filters"]["suggested_specialties"]
    assert _ids(referral)[0] == "ref_004"


def test_non_drug_case_does_not_suggest_pharmacist(client, patients):
    d = _top(client, patients, "Aisha Bello", "advice")    # on medications, but not a drug question
    assert d["applied_filters"]["suggested_specialties"] == ["Gastroenterology"]


def test_explicit_specialty_overrides_suggestion(client, patients):
    d = _dir(client, patient_id=patients["Maria Lopez"]["id"], specialty="Oncology")
    assert d["applied_filters"]["suggested_specialties"] == []
    assert {r["provider"]["specialty"] for r in d["results"]} == {"Oncology"}


def test_cannot_use_someone_elses_patient(client, patients):
    other = client.get("/hcps", params={"limit": 5}).json()
    other_id = next(h["id"] for h in other if h["id"] != "hcp_demo")
    r = client.get("/referrals/directory", params={"hcp_id": other_id, "patient_id": patients["Maria Lopez"]["id"]})
    assert r.status_code == 403


# ---------- advice / referral lifecycle ----------

def test_advice_is_deidentified(client, patients):
    maria = patients["Maria Lopez"]
    r = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_001", "type": "advice",
                                        "patient_id": maria["id"], "reason": "Stop the biologic or switch?"})
    assert r.status_code == 201
    body = r.json()
    assert body["referral"]["patient_id"] is None and body["referral"]["case_id"]
    thread = client.get(f"/referrals/{body['referral']['id']}", params={"viewer": "ref_001"}).json()
    for tok in maria["display_name"].split():
        assert tok not in str(thread)
    assert "patient" not in thread and thread["case"]["redacted_text"]


def test_reason_with_patient_name_is_rejected(client, patients):
    r = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_001", "type": "advice",
                                        "patient_id": patients["Maria Lopez"]["id"],
                                        "reason": "Maria has new heel pain, thoughts?"})
    assert r.status_code == 422 and "PATIENT_NAME" in str(r.json())


def test_message_with_identifiers_is_rejected(client, patients):
    ref = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_006", "type": "advice",
                                          "patient_id": patients["Aisha Bello"]["id"],
                                          "reason": "Celiac work-up before escalating?"}).json()["referral"]
    bad = client.post(f"/referrals/{ref['id']}/messages", json={"sender": "hcp_demo", "body": "Call me at 404-555-0101"})
    assert bad.status_code == 422
    ok = client.post(f"/referrals/{ref['id']}/messages", json={"sender": "ref_006", "body": "Check tTG-IgA first."})
    assert ok.status_code == 201


def test_polling_with_since(client, patients):
    ref = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_013", "type": "advice",
                                          "patient_id": patients["Elena Petrova"]["id"],
                                          "reason": "Recurrent swelling, what next?"}).json()["referral"]
    first = client.get(f"/referrals/{ref['id']}/messages", params={"viewer": "hcp_demo"}).json()["messages"]
    client.post(f"/referrals/{ref['id']}/messages", json={"sender": "ref_013", "body": "Check C1-INH function."})
    new = client.get(f"/referrals/{ref['id']}/messages",
                     params={"viewer": "hcp_demo", "since": first[-1]["created_at"]}).json()["messages"]
    assert [m["body"] for m in new] == ["Check C1-INH function."]


def test_referral_patient_visible_only_after_accept(client, patients):
    ref = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_002", "type": "referral",
                                          "patient_id": patients["James Carter"]["id"],
                                          "reason": "Please evaluate persistent weakness", "urgency": "soon"}).json()["referral"]
    before = client.get(f"/referrals/{ref['id']}", params={"viewer": "ref_002"}).json()
    assert before["patient_visible"] is False and "patient" not in before
    client.post(f"/referrals/{ref['id']}/status", json={"status": "accepted", "actor": "ref_002"})
    after = client.get(f"/referrals/{ref['id']}", params={"viewer": "ref_002"}).json()
    assert after["patient"]["display_name"] == "James Carter"


def test_outsiders_cannot_view_or_post(client, patients):
    ref = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_004", "type": "referral",
                                          "patient_id": patients["Robert Nguyen"]["id"],
                                          "reason": "Rash evaluation please"}).json()["referral"]
    assert client.get(f"/referrals/{ref['id']}", params={"viewer": "ref_005"}).status_code == 403
    assert client.post(f"/referrals/{ref['id']}/messages", json={"sender": "ref_005", "body": "hi"}).status_code == 403


def test_status_transitions_and_permissions(client, patients):
    ref = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_010", "type": "referral",
                                          "patient_id": patients["James Carter"]["id"],
                                          "reason": "Endocrine opinion please"}).json()["referral"]
    rid = ref["id"]
    assert client.post(f"/referrals/{rid}/status", json={"status": "completed", "actor": "hcp_demo",
                                                          "outcome": "x"}).status_code == 409
    assert client.post(f"/referrals/{rid}/status", json={"status": "accepted", "actor": "hcp_demo"}).status_code == 403
    assert client.post(f"/referrals/{rid}/status", json={"status": "accepted", "actor": "ref_010"}).status_code == 200
    assert client.post(f"/referrals/{rid}/status", json={"status": "completed", "actor": "ref_010"}).status_code == 422
    done = client.post(f"/referrals/{rid}/status", json={"status": "completed", "actor": "ref_010",
                                                          "outcome": "No endocrine cause found"})
    assert done.status_code == 200 and done.json()["referral"]["status"] == "completed"
    assert client.post(f"/referrals/{rid}/messages", json={"sender": "hcp_demo", "body": "thanks"}).status_code == 409


def test_not_accepting_provider_is_refused(client, patients):
    r = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_007", "type": "referral",
                                        "patient_id": patients["Aisha Bello"]["id"], "reason": "GI evaluation"})
    assert r.status_code == 409


def test_completion_feeds_the_case_network(client, patients):
    """accept -> complete (with outcome) -> the case becomes searchable for the next doctor."""
    elena = patients["Elena Petrova"]
    ref = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_013", "type": "advice",
                                          "patient_id": elena["id"],
                                          "reason": "Recurrent lip and hand swelling, normal C4?"}).json()["referral"]
    client.post(f"/referrals/{ref['id']}/status", json={"status": "accepted", "actor": "ref_013"})
    done = client.post(f"/referrals/{ref['id']}/status", json={
        "status": "completed", "actor": "hcp_demo", "outcome": "Episodes stopped on prophylaxis",
        "feed_network": True, "final_diagnosis": "Hereditary angioedema with normal C1-INH",
        "treatment_used": "Specialist-guided prophylaxis"}).json()
    assert done["indexed_for_future_matching"] is True

    # The NEXT doctor with a similar patient now benefits (own cases are excluded from search).
    structured = client.post(f"/patients/{elena['id']}/find-similar",
                             json={"include_evidence": False}).json()["deidentified"]["structured_preview"]
    other = next(h["id"] for h in client.get("/hcps", params={"limit": 5}).json() if h["id"] != "hcp_demo")
    m = client.post("/match", json={"author_hcp_id": other, "structured": structured,
                                    "include_evidence": False}).json()
    assert m["diagnoses_seen"][0]["diagnosis"] == "Hereditary angioedema with normal C1-INH"


def test_inbox_lists_with_message_counts(client):
    sent = client.get("/referrals", params={"hcp_id": "hcp_demo"}).json()
    assert sent and all("message_count" in r and r["provider"] for r in sent)
    received = client.get("/referrals", params={"provider_id": "ref_001"}).json()
    assert all(r["to_provider_id"] == "ref_001" for r in received)
    assert client.get("/referrals").status_code == 422


def test_simulated_reply_in_demo_mode(client, patients):
    ref = client.post("/referrals", json={"from_hcp_id": "hcp_demo", "to_provider_id": "ref_008", "type": "advice",
                                          "patient_id": patients["James Carter"]["id"],
                                          "reason": "Any oncology angle here?"}).json()["referral"]
    r = client.post(f"/referrals/{ref['id']}/simulate-reply")
    assert r.status_code == 201 and r.json()["sender"] == "ref_008" and len(r.json()["body"]) > 20
