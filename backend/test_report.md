# Backend Test Report

**Run date:** 2026-09-26  
**Scope:** Root `backend/` referral API, its isolated SQLAlchemy persistence path, and a real Uvicorn + SQLite HTTP flow.  
**Result:** **22 passed, 0 failed**. One third-party Starlette/AnyIO deprecation warning was emitted; it did not fail a test.

The test expectations were written as explicit behavior checks and were not loosened or rewritten after observing server responses. The existing `backend/test_referrals.py` tests were left unchanged. Test databases are in-memory for unit/API tests and temporary-file SQLite for the live-server test; the developer's default `clinic.db` is not used.

## Results by layer

| Layer | Passed | Failed | Coverage |
|---|---:|---:|---|
| Unit | 11 | 0 | Referral validation, state transitions, participant policy, tokenization, and message serialization |
| API integration | 10 | 0 | Seven new FastAPI/SQLAlchemy API tests plus three pre-existing referral tests |
| End-to-end | 1 | 0 | Live Uvicorn server, temporary SQLite database, HTTP referral lifecycle and persistence |
| **Total** | **22** | **0** | |

## Passed test cases

### Unit — 11 passed

Located in [tests/unit/test_referral_rules.py](tests/unit/test_referral_rules.py).

- `test_case_tokenizer_normalizes_words_and_removes_stop_words`
- `test_referral_state_machine_allows_only_documented_transitions`
- `test_referral_create_trims_reason_and_preserves_valid_urgency`
- `test_referral_create_rejects_blank_short_or_oversized_reason` — 4 parameter cases
- `test_referral_create_rejects_unsupported_urgency`
- `test_message_create_trims_text_and_rejects_blank_or_oversized_text`
- `test_participant_guard_allows_only_referring_and_receiving_doctors`
- `test_message_payload_has_stable_api_fields_and_iso_timestamp`

### API integration — 10 passed

New API tests are in [tests/integration/test_referrals_api.py](tests/integration/test_referrals_api.py); the existing tests remain in [test_referrals.py](test_referrals.py).

- `test_directory_filters_requester_and_ranks_using_case_evidence`
- `test_directory_rejects_unknown_doctor_and_patient_outside_panel`
- `test_create_referral_rejects_cross_panel_patient_and_self_referral`
- `test_create_referral_validates_reason_and_urgency`
- `test_recipient_handoff_is_hidden_until_acceptance_and_then_complete`
- `test_referral_access_status_permissions_and_closed_thread`
- `test_message_posting_history_polling_and_referral_lists`
- `test_directory_is_case_aware_and_excludes_requester`
- `test_patient_handoff_is_hidden_until_acceptance_and_messages_work`
- `test_referral_access_and_transition_permissions`

### End-to-end — 1 passed

Located in [tests/e2e/test_referral_lifecycle.py](tests/e2e/test_referral_lifecycle.py).

- `test_live_server_persists_and_completes_referral_handoff` — starts Uvicorn against a seeded temporary SQLite file and verifies HTTP directory lookup, referral creation, handoff visibility, acceptance, messaging, completion, and closed-thread rejection.

## Failed test cases

**None.**
