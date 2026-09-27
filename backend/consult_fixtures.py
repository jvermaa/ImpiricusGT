"""Deterministic peer-consult threads for the synthetic doctor directory."""

import json
import re
from datetime import datetime, timedelta
from pathlib import Path

RELATED = {
    "Cardiology": {"Pulmonology", "Endocrinology", "Neurology", "Primary Care"},
    "Endocrinology": {"Cardiology", "Gastroenterology", "Primary Care"},
    "Pulmonology": {"Cardiology", "Rheumatology", "Primary Care"},
    "Dermatology": {"Rheumatology", "Primary Care"},
    "Rheumatology": {"Dermatology", "Pulmonology", "Gastroenterology", "Primary Care"},
    "Gastroenterology": {"Endocrinology", "Rheumatology", "Primary Care"},
    "Neurology": {"Cardiology", "Primary Care"},
    "Primary Care": {
        "Cardiology",
        "Endocrinology",
        "Pulmonology",
        "Dermatology",
        "Rheumatology",
        "Gastroenterology",
        "Neurology",
    },
}

BASE_DATE = datetime(2026, 9, 27, 12, 0, 0)
AGES = (24, 34, 46, 58, 64, 72)
PATIENT_KEY = re.compile(r"\bP\d{3,}\b")
DOSE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units)\b", re.IGNORECASE)


def _related(left: dict, right: dict) -> bool:
    if left["doctor_key"] == right["doctor_key"]:
        return False
    return (
        right["specialty"] in RELATED.get(left["specialty"], set())
        or left["specialty"] in RELATED.get(right["specialty"], set())
        or left["specialty"] == right["specialty"]
    )


def _consult_edges(consulting: list[dict]) -> list[tuple[str, str]]:
    by_key = {row["doctor_key"]: row for row in consulting}
    keys = [row["doctor_key"] for row in consulting]
    targets = {key: 2 + (index % 3) for index, key in enumerate(keys)}
    degree = {key: 0 for key in keys}
    edges: set[tuple[str, str]] = set()

    def pair(left: str, right: str, *, ceiling: int) -> bool:
        if left == right or not _related(by_key[left], by_key[right]):
            return False
        ordered = (left, right) if left < right else (right, left)
        if ordered in edges or degree[left] >= ceiling or degree[right] >= ceiling:
            return False
        edges.add(ordered)
        degree[left] += 1
        degree[right] += 1
        return True

    for _ in range(6):
        for key in sorted(keys, key=lambda item: (degree[item] - targets[item], item)):
            while degree[key] < targets[key]:
                options = [
                    other
                    for other in keys
                    if degree[other] < targets[other]
                    and _related(by_key[key], by_key[other])
                    and ((key, other) if key < other else (other, key)) not in edges
                ]
                if not options:
                    break
                options.sort(
                    key=lambda other: (
                        0 if by_key[other]["specialty"] != by_key[key]["specialty"] else 1,
                        degree[other] - targets[other],
                        other,
                    )
                )
                if not pair(key, options[0], ceiling=targets[options[0]]):
                    break

    for key in keys:
        while degree[key] < 2:
            options = [
                other
                for other in keys
                if other != key
                and degree[other] < 4
                and _related(by_key[key], by_key[other])
                and ((key, other) if key < other else (other, key)) not in edges
            ]
            if not options:
                break
            options.sort(key=lambda other: (degree[other], other))
            if not pair(key, options[0], ceiling=4):
                break

    missing = [key for key in keys if not 2 <= degree[key] <= 4]
    if missing:
        raise RuntimeError(f"consult degree outside 2-4 for {missing}")
    return sorted(edges)


def _given_name(display_name: str) -> str:
    parts = [part for part in display_name.replace("Dr.", "").split() if part]
    return parts[0] if parts else display_name


def _dialogue(starter: dict, responder: dict, age: int, count: int) -> list[tuple[str, str]]:
    condition = starter["subspecialty_focus"].lower()
    asker = _given_name(starter["display_name"])
    peer = _given_name(responder["display_name"])
    lines = [
        (
            starter["doctor_key"],
            f"{peer} — I have a {age}-year-old with {condition}. It has come on gradually, and I want a peer read before the next visit.",
        ),
        (
            responder["doctor_key"],
            f"Happy to think it through, {asker}. Is there a clear trigger, or has this been a steady pattern?",
        ),
        (
            starter["doctor_key"],
            f"No single trigger. I am keeping this de-identified: age and {condition} only, with no name and no doses.",
        ),
        (
            responder["doctor_key"],
            f"That fits a routine {condition} consult. I would confirm the history and review current medicines in general terms before changing strategy.",
        ),
        (
            starter["doctor_key"],
            "Agreed. I will keep the plan general, reassess soon, and send them over if the course turns sudden.",
        ),
        (
            responder["doctor_key"],
            "Good next step. If it stays refractory, a short clinic visit is reasonable. I would not pin this to a specific dose from chat.",
        ),
        (
            starter["doctor_key"],
            "I will document that shared plan and update you after follow-up. Still no patient identifiers in this thread.",
        ),
        (
            responder["doctor_key"],
            "Sounds right. We can revisit if something new shows up. This stays a synthetic peer consult.",
        ),
    ]
    return lines[:count]


def write_consult_fixtures(data_dir: Path, doctors: list[dict]) -> list[str]:
    errors: list[str] = []
    consulting = sorted(
        (row for row in doctors if row.get("accepts_peer_consults")),
        key=lambda row: row["doctor_key"],
    )
    if len(consulting) < 2:
        return ["not enough doctors accept peer consults to build threads"]
    try:
        edges = _consult_edges(consulting)
    except RuntimeError as exc:
        return [str(exc)]

    by_key = {row["doctor_key"]: row for row in consulting}
    patients = json.loads((data_dir / "patients.json").read_text(encoding="utf-8"))
    patient_names = [row["name"] for row in patients if row.get("name")]
    threads = []
    messages = []
    message_id = 1
    for index, (doctor_a_key, doctor_b_key) in enumerate(edges, start=1):
        doctor_a = by_key[doctor_a_key]
        doctor_b = by_key[doctor_b_key]
        starter, responder = (doctor_a, doctor_b) if index % 2 else (doctor_b, doctor_a)
        age = AGES[index % len(AGES)]
        count = 4 + (index % 5)
        thread_id = f"T{index:03d}"
        started = BASE_DATE - timedelta(minutes=index * 180)
        summary = (
            f"A {age}-year-old with {starter['subspecialty_focus'].lower()}. "
            "De-identified synthetic case with no name, contact details, or doses."
        )
        threads.append(
            {
                "thread_id": thread_id,
                "doctor_a_key": doctor_a_key,
                "doctor_b_key": doctor_b_key,
                "patient_case_summary": summary,
                "created_at": started.isoformat(timespec="seconds"),
            }
        )
        for offset, (sender_key, text) in enumerate(_dialogue(starter, responder, age, count)):
            spoken_at = started + timedelta(minutes=offset * 8)
            messages.append(
                {
                    "id": message_id,
                    "thread_id": thread_id,
                    "sender_doctor_key": sender_key,
                    "text": text,
                    "created_at": spoken_at.isoformat(timespec="seconds"),
                }
            )
            message_id += 1

    window_start = BASE_DATE - timedelta(days=7)
    for row in messages:
        text = row["text"]
        thread = next(item for item in threads if item["thread_id"] == row["thread_id"])
        stamp = datetime.fromisoformat(row["created_at"])
        if not 1 <= len(text) <= 1000:
            errors.append(f"message {row['id']} is outside 1-1000 characters")
        if PATIENT_KEY.search(text) or DOSE.search(text):
            errors.append(f"message {row['id']} includes a patient key or a dose")
        lowered = text.lower()
        if any(name.lower() in lowered for name in patient_names):
            errors.append(f"message {row['id']} includes a patient name")
        if stamp < window_start or stamp > BASE_DATE:
            errors.append(f"message {row['id']} is outside the fixed 7-day window")
        if row["sender_doctor_key"] not in {thread["doctor_a_key"], thread["doctor_b_key"]}:
            errors.append(f"message {row['id']} sender is outside the thread")
    if errors:
        return errors

    for name, payload in (("consult_threads", threads), ("consult_messages", messages)):
        path = data_dir / f"{name}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return []
