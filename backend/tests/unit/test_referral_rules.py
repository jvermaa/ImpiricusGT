"""Unit tests for deterministic referral validation and policy helpers."""
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from referrals import (
    OPEN_STATUSES,
    TRANSITIONS,
    ReferralCreate,
    ReferralMessageCreate,
    _message_payload,
    _require_participant,
    _tokens,
)


def test_case_tokenizer_normalizes_words_and_removes_stop_words():
    assert _tokens("Heart failure WITH dyspnea, heart.") == {"heart", "failure", "dyspnea"}


def test_referral_state_machine_allows_only_documented_transitions():
    assert TRANSITIONS == {
        "sent": {"accepted", "declined", "cancelled"},
        "accepted": {"completed", "cancelled"},
    }
    assert OPEN_STATUSES == {"sent", "accepted"}
    assert "completed" not in OPEN_STATUSES
    assert "declined" not in OPEN_STATUSES


def test_referral_create_trims_reason_and_preserves_valid_urgency():
    request = ReferralCreate(
        from_doctor_key="D011",
        to_doctor_key="D012",
        patient_key="P001",
        reason="  Review worsening dyspnea.  ",
        urgency="soon",
    )

    assert request.reason == "Review worsening dyspnea."
    assert request.urgency == "soon"


@pytest.mark.parametrize("reason", ["", "four", "     ", "x" * 1001])
def test_referral_create_rejects_blank_short_or_oversized_reason(reason: str):
    with pytest.raises(ValidationError):
        ReferralCreate(
            from_doctor_key="D011",
            to_doctor_key="D012",
            patient_key="P001",
            reason=reason,
        )


def test_referral_create_rejects_unsupported_urgency():
    with pytest.raises(ValidationError):
        ReferralCreate(
            from_doctor_key="D011",
            to_doctor_key="D012",
            patient_key="P001",
            reason="Review worsening dyspnea.",
            urgency="emergency",
        )


def test_message_create_trims_text_and_rejects_blank_or_oversized_text():
    message = ReferralMessageCreate(sender_doctor_key="D012", text="  Reviewing now.  ")
    assert message.text == "Reviewing now."

    for text in ("", "   ", "x" * 2001):
        with pytest.raises(ValidationError):
            ReferralMessageCreate(sender_doctor_key="D012", text=text)


def test_participant_guard_allows_only_referring_and_receiving_doctors():
    referral = SimpleNamespace(from_doctor_key="D011", to_doctor_key="D012")

    _require_participant(referral, "D011")
    _require_participant(referral, "D012")
    with pytest.raises(HTTPException) as error:
        _require_participant(referral, "D013")
    assert error.value.status_code == 403


def test_message_payload_has_stable_api_fields_and_iso_timestamp():
    timestamp = datetime(2026, 9, 26, 12, 30, 45)
    message = SimpleNamespace(
        message_key="RM001",
        referral_key="RF001",
        sender_doctor_key="D012",
        text="Reviewing now.",
        created_at=timestamp,
    )

    assert _message_payload(message) == {
        "message_key": "RM001",
        "referral_key": "RF001",
        "sender_doctor_key": "D012",
        "text": "Reviewing now.",
        "timestamp": "2026-09-26T12:30:45",
    }
