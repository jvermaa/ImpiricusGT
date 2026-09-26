"""Keep the committed synthetic fixtures in ../data.

Those JSON files are the source loaded by seed.py. This script checks that
they are present and internally consistent. It does not rewrite them.
"""

import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FILES = (
    "doctors",
    "patients",
    "prescriptions",
    "labs",
    "encounters",
    "followups",
    "case_matches",
)


def main() -> None:
    errors: list[str] = []
    loaded: dict[str, list[dict]] = {}
    for name in FILES:
        path = DATA_DIR / f"{name}.json"
        if not path.exists():
            errors.append(f"missing {path}")
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, list) or not payload:
            errors.append(f"{name}.json is empty")
            continue
        loaded[name] = payload

    if errors:
        for error in errors:
            print(f"ERROR {error}")
        sys.exit(1)

    doctors = {row["doctor_key"]: row for row in loaded["doctors"]}
    patients = {row["patient_key"]: row for row in loaded["patients"]}
    prescriptions = {row["prescription_key"]: row for row in loaded["prescriptions"]}

    for patient in patients.values():
        if "synthetic" not in str(patient.get("source", "")).lower():
            errors.append(f"{patient['patient_key']} is not marked synthetic")
        if patient["primary_doctor_key"] not in doctors:
            errors.append(f"{patient['patient_key']} has no doctor")

    for doctor_key, doctor in doctors.items():
        derived = sorted(
            patient["patient_key"]
            for patient in patients.values()
            if patient["primary_doctor_key"] == doctor_key
        )
        if sorted(doctor.get("patient_keys", [])) != derived:
            errors.append(f"{doctor_key} patient_keys do not match primary_doctor_key links")

    for followup in loaded["followups"]:
        prescription = prescriptions.get(followup["prescription_key"])
        if prescription is None or prescription["patient_key"] != followup["patient_key"]:
            errors.append(f"{followup['followup_key']} prescription does not match the patient")
        if followup["delivery_status"] == "sent" and not followup["clinician_approved"]:
            errors.append(f"{followup['followup_key']} is sent without approval")
        if str(followup["channel"]).lower() in {"sms", "text", "twilio-sms"}:
            errors.append(f"{followup['followup_key']} uses SMS")

    codes = {
        patient_key: {item["code"] for item in patient["diagnoses"]}
        for patient_key, patient in patients.items()
    }
    for match in loaded["case_matches"]:
        query_patient = patients.get(match["query_patient_key"])
        candidate_patient = patients.get(match["candidate_patient_key"])
        query_doctor = doctors.get(match["query_doctor_key"])
        candidate_doctor = doctors.get(match["candidate_doctor_key"])
        shared = codes.get(match["query_patient_key"], set()) & codes.get(
            match["candidate_patient_key"], set()
        )
        if (
            query_patient is None
            or candidate_patient is None
            or query_doctor is None
            or candidate_doctor is None
            or match["query_doctor_key"] == match["candidate_doctor_key"]
            or not shared
            or not query_doctor["case_exchange_opt_in"]
            or not candidate_doctor["case_exchange_opt_in"]
            or query_patient["sharing_preference_for_peer_cases"] != "de-identified case only"
            or candidate_patient["sharing_preference_for_peer_cases"] != "de-identified case only"
        ):
            errors.append(
                f"case match {match['query_patient_key']} -> {match['candidate_patient_key']} fails consent rules"
            )

    if errors:
        for error in errors[:20]:
            print(f"ERROR {error}")
        sys.exit(1)

    print(f"Fixtures in {DATA_DIR} already exist and passed integrity checks.")
    print("Left data/*.json unchanged.")
    print("Clean.")


if __name__ == "__main__":
    main()
