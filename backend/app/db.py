"""SQLite persistence for HCPs, cases and peer responses.

Privacy rule enforced here: the raw (pre-de-identification) case text is NEVER
stored. Only the redacted text and the structured summary are persisted.
"""
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS hcps (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    specialty           TEXT NOT NULL,
    subspecialty        TEXT,
    focus_areas         TEXT NOT NULL DEFAULT '[]',   -- JSON list
    drug_classes        TEXT NOT NULL DEFAULT '[]',   -- JSON list
    state               TEXT,
    years_experience    INTEGER DEFAULT 0,
    response_rate       REAL DEFAULT 0.5,             -- 0..1
    avg_response_hours  REAL DEFAULT 24,
    cases_answered      INTEGER DEFAULT 0,
    accepting_cases     INTEGER DEFAULT 1,
    is_synthetic        INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cases (
    id                  TEXT PRIMARY KEY,
    author_hcp_id       TEXT NOT NULL REFERENCES hcps(id),
    redacted_text       TEXT NOT NULL,
    structured          TEXT NOT NULL,                -- JSON (StructuredCase)
    status              TEXT NOT NULL DEFAULT 'open', -- open | resolved
    final_diagnosis     TEXT,
    treatment_used      TEXT,                         -- what was done once diagnosed
    outcome             TEXT,                         -- how the patient responded
    resolved_by_hcp_id  TEXT REFERENCES hcps(id),
    consent_to_index    INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL,
    resolved_at         TEXT
);

CREATE TABLE IF NOT EXISTS responses (
    id           TEXT PRIMARY KEY,
    case_id      TEXT NOT NULL REFERENCES cases(id),
    hcp_id       TEXT NOT NULL REFERENCES hcps(id),
    body         TEXT NOT NULL,
    helpful      INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL
);

-- A doctor's OWN patients (in production: DocUpdate's existing patient list used for
-- ePrescribing). Identifiable, visible only to their own doctor, never embedded or
-- shared. Only a de-identified copy of the clinical summary ever leaves this table.
CREATE TABLE IF NOT EXISTS patients (
    id            TEXT PRIMARY KEY,
    hcp_id        TEXT NOT NULL REFERENCES hcps(id),
    display_name  TEXT NOT NULL,
    age           INTEGER,
    sex           TEXT,
    summary       TEXT NOT NULL,
    medications   TEXT NOT NULL DEFAULT '[]',          -- JSON list
    is_synthetic  INTEGER DEFAULT 1,
    created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patients_hcp ON patients(hcp_id);
CREATE INDEX IF NOT EXISTS idx_cases_author ON cases(author_hcp_id);
CREATE INDEX IF NOT EXISTS idx_responses_case ON responses(case_id);
"""

JSON_FIELDS = {"focus_areas", "drug_classes", "structured", "medications"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@contextmanager
def conn():
    c = sqlite3.connect(config.SQLITE_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with conn() as c:
        c.executescript(SCHEMA)


def _row(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    for k in JSON_FIELDS & d.keys():
        d[k] = json.loads(d[k]) if d[k] else None
    for k in ("accepting_cases", "is_synthetic", "consent_to_index", "helpful"):
        if k in d and d[k] is not None:
            d[k] = bool(d[k])
    return d


# ---------- HCPs ----------

def insert_hcp(h: dict) -> dict:
    h = {**h}
    h.setdefault("id", new_id("hcp"))
    with conn() as c:
        c.execute(
            """INSERT INTO hcps (id, display_name, specialty, subspecialty, focus_areas,
               drug_classes, state, years_experience, response_rate, avg_response_hours,
               cases_answered, accepting_cases, is_synthetic)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                h["id"], h["display_name"], h["specialty"], h.get("subspecialty"),
                json.dumps(h.get("focus_areas", [])), json.dumps(h.get("drug_classes", [])),
                h.get("state"), h.get("years_experience", 0), h.get("response_rate", 0.5),
                h.get("avg_response_hours", 24), h.get("cases_answered", 0),
                int(h.get("accepting_cases", True)), int(h.get("is_synthetic", True)),
            ),
        )
    return get_hcp(h["id"])


def get_hcp(hcp_id: str) -> dict | None:
    with conn() as c:
        return _row(c.execute("SELECT * FROM hcps WHERE id=?", (hcp_id,)).fetchone())


def get_hcps(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    q = ",".join("?" * len(ids))
    with conn() as c:
        rows = c.execute(f"SELECT * FROM hcps WHERE id IN ({q})", ids).fetchall()
    return {r["id"]: _row(r) for r in rows}


def list_hcps(limit: int = 50, offset: int = 0) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM hcps ORDER BY display_name LIMIT ? OFFSET ?",
                         (limit, offset)).fetchall()
    return [_row(r) for r in rows]


def increment_answered(hcp_id: str) -> None:
    with conn() as c:
        c.execute("UPDATE hcps SET cases_answered = cases_answered + 1 WHERE id=?", (hcp_id,))


# ---------- Cases ----------

def insert_case(author_hcp_id: str, redacted_text: str, structured: dict,
                consent_to_index: bool, status: str = "open",
                final_diagnosis: str | None = None,
                resolved_by_hcp_id: str | None = None, case_id: str | None = None,
                treatment_used: str | None = None, outcome: str | None = None) -> dict:
    cid = case_id or new_id("case")
    ts = now()
    with conn() as c:
        c.execute(
            """INSERT INTO cases (id, author_hcp_id, redacted_text, structured, status,
               final_diagnosis, treatment_used, outcome, resolved_by_hcp_id, consent_to_index,
               created_at, resolved_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (cid, author_hcp_id, redacted_text, json.dumps(structured), status,
             final_diagnosis, treatment_used, outcome, resolved_by_hcp_id, int(consent_to_index),
             ts, ts if status == "resolved" else None),
        )
    return get_case(cid)


def get_case(case_id: str) -> dict | None:
    with conn() as c:
        return _row(c.execute("SELECT * FROM cases WHERE id=?", (case_id,)).fetchone())


def get_cases(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    q = ",".join("?" * len(ids))
    with conn() as c:
        rows = c.execute(f"SELECT * FROM cases WHERE id IN ({q})", ids).fetchall()
    return {r["id"]: _row(r) for r in rows}


def list_cases_for_author(hcp_id: str) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM cases WHERE author_hcp_id=? ORDER BY created_at DESC",
                         (hcp_id,)).fetchall()
    return [_row(r) for r in rows]


def resolve_case(case_id: str, final_diagnosis: str, resolved_by_hcp_id: str | None,
                 treatment_used: str | None = None, outcome: str | None = None) -> dict:
    with conn() as c:
        c.execute(
            """UPDATE cases SET status='resolved', final_diagnosis=?, treatment_used=?, outcome=?,
               resolved_by_hcp_id=?, resolved_at=? WHERE id=?""",
            (final_diagnosis, treatment_used, outcome, resolved_by_hcp_id, now(), case_id),
        )
    return get_case(case_id)


def resolved_indexed_cases() -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM cases WHERE status='resolved' AND consent_to_index=1").fetchall()
    return [_row(r) for r in rows]


# ---------- Responses ----------

def insert_response(case_id: str, hcp_id: str, body: str) -> dict:
    rid = new_id("resp")
    with conn() as c:
        c.execute("INSERT INTO responses (id, case_id, hcp_id, body, created_at) VALUES (?,?,?,?,?)",
                  (rid, case_id, hcp_id, body, now()))
    increment_answered(hcp_id)
    with conn() as c:
        return _row(c.execute("SELECT * FROM responses WHERE id=?", (rid,)).fetchone())


def list_responses(case_id: str) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM responses WHERE case_id=? ORDER BY created_at",
                         (case_id,)).fetchall()
    return [_row(r) for r in rows]


def mark_helpful(response_id: str) -> None:
    with conn() as c:
        c.execute("UPDATE responses SET helpful=1 WHERE id=?", (response_id,))


def responders_by_case(case_ids: list[str]) -> dict[str, set[str]]:
    """case_id -> set of hcp_ids who replied (used as 'has seen this before' evidence)."""
    if not case_ids:
        return {}
    q = ",".join("?" * len(case_ids))
    with conn() as c:
        rows = c.execute(f"SELECT case_id, hcp_id FROM responses WHERE case_id IN ({q})",
                         case_ids).fetchall()
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(r["case_id"], set()).add(r["hcp_id"])
    return out


# ---------- Patients (the doctor's own patient page) ----------

def insert_patient(hcp_id: str, display_name: str, age: int | None, sex: str | None,
                   summary: str, medications: list[str], patient_id: str | None = None,
                   is_synthetic: bool = True) -> dict:
    pid = patient_id or new_id("pat")
    with conn() as c:
        c.execute(
            """INSERT INTO patients (id, hcp_id, display_name, age, sex, summary, medications,
               is_synthetic, created_at) VALUES (?,?,?,?,?,?,?,?,?)""",
            (pid, hcp_id, display_name, age, sex, summary, json.dumps(medications),
             int(is_synthetic), now()),
        )
    return get_patient(pid)


def get_patient(patient_id: str) -> dict | None:
    with conn() as c:
        return _row(c.execute("SELECT * FROM patients WHERE id=?", (patient_id,)).fetchone())


def list_patients(hcp_id: str) -> list[dict]:
    with conn() as c:
        rows = c.execute("SELECT * FROM patients WHERE hcp_id=? ORDER BY display_name",
                         (hcp_id,)).fetchall()
    return [_row(r) for r in rows]
