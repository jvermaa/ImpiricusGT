"""Central configuration, read from environment variables."""
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("PCX_DATA_DIR", "./data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_PATH = DATA_DIR / "pcx.sqlite3"
CHROMA_PATH = DATA_DIR / "chroma"

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
LLM_MODEL = os.getenv("PCX_LLM_MODEL", "claude-sonnet-5")
OFFLINE = os.getenv("PCX_OFFLINE", "0") == "1"
K_MIN = int(os.getenv("PCX_K_MIN", "5"))

# Peer ranking weights (tune live during the demo if you want)
W_EXPERTISE = 0.50      # similarity of case to the HCP's expertise profile
W_CASE_EVIDENCE = 0.35  # HCP resolved/answered similar cases before
W_SPECIALTY = 0.10      # HCP specialty matches the case's specialty hints
W_RESPONSIVE = 0.05     # historical response rate

SIMILAR_CASE_MIN_SIM = 0.25  # below this, a "similar" case is noise

# A diagnosis is surfaced only if >= DX_MIN_AGREEING similar cases share it, or a single
# case is very close (>= DX_SINGLE_CASE_SIM). Stops one loosely similar case from
# being presented as "what patients like this had".
DX_MIN_AGREEING = 2
DX_SINGLE_CASE_SIM = 0.6
