"""FastAPI + isolated SQLAlchemy integration tests for the referrals API."""


def create_referral(client):
    response = client.post(
        "/referrals",
        json={
            "from_doctor_key": "D011",
            "to_doctor_key": "D012",
            "patient_key": "P001",
            "reason": "Please assess worsening exertional dyspnea.",
            "urgency": "soon",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["referral"]


def test_directory_filters_requester_and_ranks_using_case_evidence(api_client):
    response = api_client.get(
        "/referrals/directory",
        params={"doctor": "D011", "patient_key": "P001"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requesting_doctor_key"] == "D011"
    assert payload["patient_key"] == "P001"
    assert payload["total"] == 2
    assert all(row["provider"]["doctor_key"] != "D011" for row in payload["results"])
    assert payload["results"][0]["provider"]["doctor_key"] == "D012"
    assert payload["results"][0]["score"] > payload["results"][1]["score"]
    assert "Has a similar-case match in the clinic network" in payload["results"][0]["reasons"]


def test_directory_rejects_unknown_doctor_and_patient_outside_panel(api_client):
    unknown_doctor = api_client.get("/referrals/directory", params={"doctor": "D999"})
    other_doctors_patient = api_client.get(
        "/referrals/directory",
        params={"doctor": "D012", "patient_key": "P001"},
    )

    assert unknown_doctor.status_code == 404
    assert other_doctors_patient.status_code == 403


def test_create_referral_rejects_cross_panel_patient_and_self_referral(api_client):
    cross_panel = api_client.post(
        "/referrals",
        json={
            "from_doctor_key": "D012",
            "to_doctor_key": "D013",
            "patient_key": "P001",
            "reason": "Please review this patient's symptoms.",
        },
    )
    self_referral = api_client.post(
        "/referrals",
        json={
            "from_doctor_key": "D011",
            "to_doctor_key": "D011",
            "patient_key": "P001",
            "reason": "Please review this patient's symptoms.",
        },
    )

    assert cross_panel.status_code == 403
    assert self_referral.status_code == 422


def test_create_referral_validates_reason_and_urgency(api_client):
    base = {
        "from_doctor_key": "D011",
        "to_doctor_key": "D012",
        "patient_key": "P001",
    }
    short_reason = api_client.post("/referrals", json={**base, "reason": "no"})
    whitespace_reason = api_client.post("/referrals", json={**base, "reason": "     "})
    invalid_urgency = api_client.post(
        "/referrals",
        json={**base, "reason": "Please assess dyspnea.", "urgency": "emergency"},
    )

    assert short_reason.status_code == 422
    assert whitespace_reason.status_code == 422
    assert invalid_urgency.status_code == 422


def test_recipient_handoff_is_hidden_until_acceptance_and_then_complete(api_client):
    referral = create_referral(api_client)
    key = referral["referral_key"]

    before_acceptance = api_client.get(
        f"/referrals/{key}", params={"viewer": "D012"}
    )
    assert before_acceptance.status_code == 200
    assert before_acceptance.json()["patient_visible"] is False
    assert before_acceptance.json()["patient_handoff"] is None
    assert before_acceptance.json()["referral"]["patient_label"] is None

    accepted = api_client.post(
        f"/referrals/{key}/status",
        json={"status": "accepted", "actor_doctor_key": "D012"},
    )
    assert accepted.status_code == 200
    handoff = accepted.json()["patient_handoff"]
    assert accepted.json()["patient_visible"] is True
    assert handoff["patient_key"] == "P001"
    assert handoff["patient_display_label"] == "Synthetic Patient"
    assert handoff["age_group"] == "45-54"
    assert handoff["symptoms"] == ["dyspnea", "fatigue"]
    assert handoff["diagnoses"] == [
        {"label": "Heart failure", "code": "I50.9", "status": "active"}
    ]
    assert handoff["status"] == "draft not clinically verified"

    completed_without_outcome = api_client.post(
        f"/referrals/{key}/status",
        json={"status": "completed", "actor_doctor_key": "D012"},
    )
    assert completed_without_outcome.status_code == 422
    completed = api_client.post(
        f"/referrals/{key}/status",
        json={
            "status": "completed",
            "actor_doctor_key": "D012",
            "outcome": "Cardiac evaluation completed.",
        },
    )
    assert completed.status_code == 200
    assert completed.json()["referral"]["status"] == "completed"
    assert completed.json()["referral"]["outcome"] == "Cardiac evaluation completed."


def test_referral_access_status_permissions_and_closed_thread(api_client):
    referral = create_referral(api_client)
    key = referral["referral_key"]

    outsider_read = api_client.get(f"/referrals/{key}", params={"viewer": "D013"})
    outsider_message = api_client.post(
        f"/referrals/{key}/messages",
        json={"sender_doctor_key": "D013", "text": "I would like to review this."},
    )
    sender_cannot_accept = api_client.post(
        f"/referrals/{key}/status",
        json={"status": "accepted", "actor_doctor_key": "D011"},
    )
    invalid_transition = api_client.post(
        f"/referrals/{key}/status",
        json={
            "status": "completed",
            "actor_doctor_key": "D012",
            "outcome": "Attempted out-of-order completion.",
        },
    )

    assert outsider_read.status_code == 403
    assert outsider_message.status_code == 403
    assert sender_cannot_accept.status_code == 403
    assert invalid_transition.status_code == 409

    accepted = api_client.post(
        f"/referrals/{key}/status",
        json={"status": "accepted", "actor_doctor_key": "D012"},
    )
    assert accepted.status_code == 200
    completed = api_client.post(
        f"/referrals/{key}/status",
        json={
            "status": "completed",
            "actor_doctor_key": "D011",
            "outcome": "Evaluation completed.",
        },
    )
    assert completed.status_code == 200
    closed_message = api_client.post(
        f"/referrals/{key}/messages",
        json={"sender_doctor_key": "D011", "text": "This should not be accepted."},
    )
    assert closed_message.status_code == 409


def test_message_posting_history_polling_and_referral_lists(api_client):
    referral = create_referral(api_client)
    key = referral["referral_key"]
    initial = api_client.get(
        f"/referrals/{key}/messages", params={"viewer": "D011"}
    )
    assert initial.status_code == 200
    assert len(initial.json()["messages"]) == 1
    first_timestamp = initial.json()["messages"][0]["timestamp"]

    sent = api_client.post(
        f"/referrals/{key}/messages",
        json={"sender_doctor_key": "D012", "text": "I will review the cardiac history."},
    )
    assert sent.status_code == 201
    assert sent.json()["text"] == "I will review the cardiac history."

    polled = api_client.get(
        f"/referrals/{key}/messages",
        params={"viewer": "D011", "since": first_timestamp},
    )
    assert polled.status_code == 200
    assert [message["text"] for message in polled.json()["messages"]] == [
        "I will review the cardiac history."
    ]

    invalid_since = api_client.get(
        f"/referrals/{key}/messages",
        params={"viewer": "D011", "since": "not-a-timestamp"},
    )
    assert invalid_since.status_code == 422
    sent_list = api_client.get("/referrals", params={"doctor": "D011"})
    received_list = api_client.get("/referrals", params={"doctor": "D012"})
    assert sent_list.status_code == 200
    assert received_list.status_code == 200
    assert sent_list.json()[0]["referral_key"] == key
    assert received_list.json()[0]["referral_key"] == key
