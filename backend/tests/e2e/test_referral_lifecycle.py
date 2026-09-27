"""Live HTTP end-to-end test using a temporary SQLite database and Uvicorn."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]


def _http_json(base_url: str, path: str, method: str = "GET", payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


@pytest.fixture(scope="module")
def live_backend(tmp_path_factory):
    database_path = tmp_path_factory.mktemp("live-backend") / "clinic.sqlite3"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{database_path}"
    env.pop("PUBLIC_VOICE_WSS_URL", None)

    subprocess.run(
        [sys.executable, "-c", "import seed; seed.seed()"],
        cwd=BACKEND_DIR,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=BACKEND_DIR,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base_url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            pytest.fail(f"Uvicorn exited before becoming ready (exit code {process.returncode}).")
        try:
            status, _ = _http_json(base_url, "/doctors/D001")
            if status == 200:
                break
        except (OSError, TimeoutError, urllib.error.URLError):
            pass
        time.sleep(0.1)
    else:
        process.terminate()
        process.wait(timeout=5)
        pytest.fail("Uvicorn did not become ready within 15 seconds.")

    try:
        yield base_url
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def test_live_server_persists_and_completes_referral_handoff(live_backend):
    base_url = live_backend

    status, doctor = _http_json(base_url, "/doctors/D001")
    assert status == 200
    assert doctor["doctor_key"] == "D001"

    status, directory = _http_json(
        base_url,
        "/referrals/directory?doctor=D001&patient_key=P001",
    )
    assert status == 200
    assert directory["requesting_doctor_key"] == "D001"
    assert all(row["provider"]["doctor_key"] != "D001" for row in directory["results"])

    status, created = _http_json(
        base_url,
        "/referrals",
        method="POST",
        payload={
            "from_doctor_key": "D001",
            "to_doctor_key": "D002",
            "patient_key": "P001",
            "reason": "Please review the patient's hypertension management.",
            "urgency": "soon",
        },
    )
    assert status == 201
    referral_key = created["referral"]["referral_key"]
    assert created["referral"]["status"] == "sent"
    assert len(created["messages"]) == 1

    status, before_acceptance = _http_json(
        base_url,
        f"/referrals/{referral_key}?viewer=D002",
    )
    assert status == 200
    assert before_acceptance["patient_visible"] is False
    assert before_acceptance["patient_handoff"] is None

    status, accepted = _http_json(
        base_url,
        f"/referrals/{referral_key}/status",
        method="POST",
        payload={"status": "accepted", "actor_doctor_key": "D002"},
    )
    assert status == 200
    assert accepted["patient_visible"] is True
    assert accepted["patient_handoff"]["patient_key"] == "P001"
    assert accepted["patient_handoff"]["diagnoses"][0]["label"] == "Hypertension"

    status, message = _http_json(
        base_url,
        f"/referrals/{referral_key}/messages",
        method="POST",
        payload={
            "sender_doctor_key": "D002",
            "text": "I will review the latest blood pressure readings.",
        },
    )
    assert status == 201
    assert message["sender_doctor_key"] == "D002"

    status, completed = _http_json(
        base_url,
        f"/referrals/{referral_key}/status",
        method="POST",
        payload={
            "status": "completed",
            "actor_doctor_key": "D001",
            "outcome": "Follow-up plan agreed with the receiving doctor.",
        },
    )
    assert status == 200
    assert completed["referral"]["status"] == "completed"
    assert completed["referral"]["outcome"] == "Follow-up plan agreed with the receiving doctor."

    status, closed_thread_message = _http_json(
        base_url,
        f"/referrals/{referral_key}/messages",
        method="POST",
        payload={"sender_doctor_key": "D001", "text": "A message after completion."},
    )
    assert status == 409
    assert "no new messages" in closed_thread_message["detail"]
