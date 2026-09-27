# ImpiricusGT
Hack GT 2026

## Backend

From `backend`, with the virtualenv active:

```bash
pip install -r requirements.txt
copy .env.example .env
python generate_fixtures.py
python seed.py
python check_db.py
python -m pytest -q
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

`generate_fixtures.py` and `seed.py` both finish with `Clean.` when the synthetic fixtures are consistent. `check_db.py` does the same for the loaded database.

Patient email drafts come from Gemini when `GEMINI_API_KEY` is set. If Gemini is unavailable or returns clinical text, the API stores a plain portal template instead. Nothing is sent until a doctor approves it. With `EMAIL_SENDING_ENABLED=false`, send is simulated. For a real inbox, use a Gmail App Password or a Mailtrap sandbox, and set `EMAIL_REDIRECT_TO` to the team inbox so messages never go to a patient address during the demo.

Referral suggestions are ranked from doctors already loaded in `clinic.db`. Gemini can only re-order that candidate list.
