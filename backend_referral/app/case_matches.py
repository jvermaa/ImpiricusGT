import copy
import json
import math
from functools import lru_cache
from pathlib import Path

CASE_MATCHES_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "case_matches.json"
)

REQUIRED = {
    "query_patient_key",
    "candidate_patient_key",
    "query_doctor_key",
    "candidate_doctor_key",
    "matching_feature",
    "review_status",
    "score",
}


class CaseMatchDataError(RuntimeError):
    """The case-match fixture is missing or invalid."""


@lru_cache(maxsize=1)
def _load_case_matches() -> tuple[dict, ...]:
    try:
        rows = json.loads(CASE_MATCHES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CaseMatchDataError(
            f"Could not load case matches from {CASE_MATCHES_PATH}: {exc}"
        ) from exc

    if not isinstance(rows, list):
        raise CaseMatchDataError("case_matches.json must contain a JSON list")

    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not REQUIRED.issubset(row):
            raise CaseMatchDataError(f"Invalid case-match record at index {index}")

        for field in REQUIRED - {"score"}:
            if not isinstance(row[field], str) or not row[field].strip():
                raise CaseMatchDataError(
                    f"Invalid {field} in case-match record at index {index}"
                )

        score = row["score"]
        if score is not None and (
            isinstance(score, bool)
            or not isinstance(score, (int, float))
            or not math.isfinite(score)
        ):
            raise CaseMatchDataError(f"Invalid score at index {index}")

    return tuple(rows)


def load_case_matches() -> list[dict]:
    return copy.deepcopy(_load_case_matches())


def matches_for_patient(patient_key: str) -> list[dict]:
    return [
        copy.deepcopy(row)
        for row in _load_case_matches()
        if row["query_patient_key"] == patient_key
    ]