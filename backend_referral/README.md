# Referrals: Backend Spec

**Owner:** backend engineer
**Status:** **Part 1 is implemented** (branch with `app/referrals/`, 29 tests in `tests/test_referrals.py`). Part 2 (real proximity) is for after the hackathon.

> **Implementation notes: where the code differs from the first draft of this spec.** These came out of testing the ranking against all five demo patients:
> - **Ranking weights changed** (§5 is updated). The list is already filtered to the suggested specialties, so specialty only orders providers *within* it. Case evidence now drives the ranking.
> - **Literal focus-area matches** count toward relevance. "enthesitis" appearing in both the case and a provider's focus areas is strong, explainable evidence, and it behaves the same with either embedder.
> - **The requester's own specialty is demoted** when the case points to another specialty. A dermatologist asking about joints gets rheumatology first.
> - **The clinical pharmacist is suggested for drug questions in advice mode only.** A formal referral hands over care, so pharmacy isn't auto-suggested there.
> - **New `question` parameter** on `/referrals/directory`. The doctor's question sharpens the suggestions, e.g. "Is this drug related?" brings in the pharmacist.
> - **Thread access:** `GET` endpoints take `viewer=` and `POST /status` takes `actor=`, and each is checked against the sender and recipient.
> - **Fix in `structuring.py`:** specialty keywords now match on word boundaries. Before, `"ck "` (creatine kinase) matched "che**ck** before" and suggested Rheumatology by mistake.
> - **Fix in `scripts/seed.py`:** it resets Chroma through the client instead of deleting its folder, which corrupted a live client when re-seeding.
**Plugs into:** the existing FastAPI backend (`backend/app/`), which uses SQLite (`db.py`), Chroma (`vectorstore.py`), and de-identification (`deid.py`).

---

## 1. What we're building

A doctor is looking at a patient and decides someone else should weigh in. They open **Refer / Ask**, see a list of HCPs (doctors, NPs, PAs, nurses, pharmacists) filtered by specialty and sorted by relevance and proximity, then either:

- **Ask for advice:** a de-identified curbside question that opens a chat thread, or
- **Send a referral:** a formal handoff of the patient, which also opens a chat thread.

This spec answers two questions:

1. **How do we narrow the list?** By specialty (plus role, focus area, and availability), then rank by relevance and distance.
2. **How do we do proximity without Google Maps?** For the demo, a JSON file with a **hardcoded `distance_miles`**. The same doctors and distances load every time. The code is built around a pluggable `ProximityProvider`, so the real distance calculation can replace the hardcoded one later without changing the API or the frontend.

### Rules check (read before building)

DocUpdate's December 2025 redesign already includes screens for **managing referrals**. The hackathon bans recreating existing features, so **a plain "pick a specialist and send" referral would be at risk.** Our version has to show clearly different value:

| DocUpdate (existing, as far as we know) | Ours (new) |
|---|---|
| Send and manage referrals | **Routes the referral using the case itself.** The patient's case structuring suggests the specialty, and the ranking favors HCPs whose focus areas match this case and who have resolved similar cases (reusing the peer case exchange) |
| Doctors | **The whole care team:** NPs, PAs, nurses, and pharmacists. Sometimes the right first step is a nurse navigator or a clinical pharmacist, not a specialist |
| Referral as a form | **Advice before referral:** a de-identified curbside chat first. Many referrals turn out to be unnecessary once a question is answered |
| Outcome unknown | **Closed loop:** the referral outcome feeds back into the case network, the same way `/resolve` does |

Put this table on a slide. Nobody on the team has verified exactly what DocUpdate's referral screens do, so describe the difference as "what we add," not "what they lack."

---

## 2. User flow

```
Patient page ──> [Refer / Ask] ──> GET /referrals/directory?patient_id=…
                                        │  specialty pre-filled from the case
                                        ▼
                          List: filters (specialty, role, distance, telehealth)
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             ▼                                                     ▼
   [Ask for advice]                                        [Send referral]
   POST /referrals {type:"advice"}                         POST /referrals {type:"referral"}
   de-identified case only                                 patient handoff (see Privacy)
             └──────────────────────────┬──────────────────────────┘
                                        ▼
                  Chat thread: GET/POST /referrals/{id}/messages
                                        ▼
            accept → complete (with outcome) → optionally feeds the case network
```

---

## 3. Problem 1a: narrowing the list by specialty

### Filters (all optional, combined with AND)

| Query param | Example | Notes |
|---|---|---|
| `specialty` | `Rheumatology` | Exact match on the normalized specialty name. Can be repeated: `?specialty=Rheumatology&specialty=Dermatology` |
| `role` | `physician`, `nurse_practitioner`, `physician_assistant`, `nurse`, `pharmacist` | Can be repeated |
| `focus` | `psoriatic arthritis` | Case-insensitive substring match on `focus_areas` |
| `max_distance` | `25` | In miles. Telehealth providers are **not** dropped by this filter if `include_telehealth=true` |
| `include_telehealth` | `true` (default) | Keep far-away providers who offer telehealth |
| `accepting` | `true` (default) | Hide providers not accepting referrals |
| `language` | `Spanish` | Exact match against `languages` |
| `patient_id` or `case_id` | `pat_…` | **Turns on case-aware mode** (see below) |
| `sort` | `best` (default) or `distance` | |

### Case-aware mode (this is the originality point)

When a `patient_id` or `case_id` is passed:

1. Reuse the existing pipeline to structure the case. For a patient, that's `deid.deidentify(..., known_identifiers=[name])`, then `structuring.structure_case(...)`. This is the same code path as `/patients/{id}/find-similar`, so factor it into a helper instead of copying it.
2. Take `structured["specialty_hints"]`, e.g. `["Dermatology", "Rheumatology"]`.
3. If the request didn't specify `specialty`, **pre-filter to those hints** and return them in `applied_filters.suggested_specialties`. The frontend shows them as removable chips: "Suggested: Rheumatology ✕".
4. Compute **case relevance** for each provider: embed the provider's `focus_areas` and `subspecialty` with the existing embedder (`embeddings.get_embedder()`, the same one used for HCP profiles), and take the cosine similarity with the case document (`vectorstore.case_document(structured)`). Embed the 15 providers once at startup and cache the vectors.

### Specialty normalization

Everything uses **one list of specialty names**. For the demo, use the list already in `structuring.SPECIALTY_KEYWORDS`, plus `"Clinical Pharmacy"`. Put this in `referrals/taxonomy.py`:

```python
SPECIALTIES = ["Dermatology", "Rheumatology", "Gastroenterology", "Oncology", "Endocrinology",
               "Pulmonology", "Neurology", "Internal Medicine", "Clinical Pharmacy"]
ROLES = ["physician", "nurse_practitioner", "physician_assistant", "nurse", "pharmacist"]
```

Reject unknown values with a 422 that lists the valid ones. In the real version, these map to **NUCC Health Care Provider Taxonomy codes**, which is what the NPI registry uses (see Part 2).

### Facets endpoint

`GET /referrals/specialties` returns counts, so the frontend can show "Rheumatology (4)":

```json
{"specialties": [{"name": "Rheumatology", "count": 4}, ...],
 "roles": [{"name": "physician", "count": 10}, ...]}
```

Counts respect `accepting=true` by default.

---

## 4. Problem 1b: proximity without Google Maps

### Demo behavior (build this now)

- Distances come from `distance_miles` in `fixtures/referral_directory.json`.
- They're **fixed and relative to `hcp_demo`**. Every request returns the same numbers, which keeps the demo repeatable.
- **Don't put the JSON in `backend/data/`.** That folder is in `.gitignore` and gets wiped by the seed script. Use **`backend/fixtures/referral_directory.json`**.
- Load the file **once at startup** and validate it with Pydantic. A bad fixture should fail fast with a clear error, not break halfway through the demo.

### The one abstraction that makes Part 2 easy

All distance logic goes through a single interface. The rest of the code never reads `distance_miles` directly.

```python
# app/referrals/proximity.py
from typing import Protocol

class ProximityProvider(Protocol):
    name: str
    def distance_miles(self, origin_hcp_id: str, provider: dict) -> float | None:
        """Miles from the requesting HCP to this provider. None = unknown."""


class HardcodedProximity:
    """DEMO ONLY. Returns the fixture's distance_miles regardless of origin.
    Valid only because every demo request comes from hcp_demo."""
    name = "hardcoded"

    def distance_miles(self, origin_hcp_id, provider):
        return provider.get("distance_miles")


def get_proximity() -> ProximityProvider:
    # Switch with PCX_PROXIMITY=hardcoded|haversine (config.py). Part 2 adds HaversineProximity.
    return HardcodedProximity()
```

Every response includes `"proximity_source": "hardcoded"`. Judges can see it, and nobody confuses it with real data later.

### Distance bands (show these, not decimals)

A raw "6.1 mi" suggests more precision than we have. The API returns both the number and a band, and the UI shows the band:

| Band | Rule |
|---|---|
| `nearby` | < 5 mi |
| `in_area` | 5–15 mi |
| `regional` | 15–50 mi |
| `far` | > 50 mi |
| `unknown` | distance is `None` |

Providers with `telehealth: true` also get a **"Telehealth"** badge. For advice requests, distance matters much less.

---

## 5. Ranking (`sort=best`)

```
score = 0.50 * case_relevance      # 0..1 (0 if no case given)
      + 0.10 * specialty_fit       # position in suggested list: 1.0, 0.8, 0.6 ... (min 0.4)
      + 0.20 * proximity_score     # see below
      + 0.15 * role_fit            # see below
      + 0.05 * responsiveness      # 1 - min(avg_response_hours, 48)/48

case_relevance = 0.6 * embedding_similarity + 0.4 * min(1, focus_matches / 2)
```

- **focus_matches:** the provider's focus areas that share a meaningful word with the case (generic words like "care" or "therapy" are ignored). They're returned in `score_breakdown.focus_matches` and shown as the first reason.
- **proximity_score** = `max(0, 1 - distance/50)`. For `type=advice`, or a provider offering telehealth, it's floored at 0.6.
- **role_fit:** physicians, NPs, and PAs always get 1.0. For `type=referral`, everyone else gets 0.3. For `type=advice`, a pharmacist on a drug question gets 1.0 and other roles get 0.6.
- **When no case is given:** `0.40 specialty + 0.35 proximity + 0.15 role + 0.10 responsiveness`.
- **`sort=distance`:** ascending distance, with `None` last, then by score, then by id. The id tie-break makes results fully deterministic.
- All weights are in `config.py`, and every result returns `score_breakdown`.

Each result gets up to 3 `reasons`: the matching focus areas (or the specialty and subspecialty when nothing matches), the distance with a telehealth note, and the typical reply time.

**Verified ranking on the demo patients** (tests lock these in):

| Patient (question) | Mode | First choice |
|---|---|---|
| Maria Lopez (joint pain on dupilumab) | referral / advice | Dr. Okonkwo, rheumatology, matched on "enthesitis" |
| James Carter (weakness after statin) | referral | Dr. Novak, neuromuscular, matched on "statin myopathy" |
| Robert Nguyen ("Is this drug related?") | advice | Dr. Adeyemi, **clinical pharmacist**, matched on "drug-induced reactions" |
| Robert Nguyen | referral | Dr. Lindqvist, dermatology (pharmacy not auto-suggested) |
| Aisha Bello (on medications, not a drug question) | advice | Gastroenterology only, no pharmacist |

**Optional bonus (not built):** if a provider's `hcp_id` is in the peer network, add "Resolved N similar cases" by reusing `matching.py`.

---

## 6. Data

### Fixture schema (`fixtures/referral_directory.json`)

```json
{
  "id": "ref_001",
  "hcp_id": null,
  "name": "Dr. Maya Okonkwo",
  "credentials": "MD",
  "role": "physician",
  "specialty": "Rheumatology",
  "subspecialty": "Inflammatory arthritis",
  "focus_areas": ["psoriatic arthritis", "biologic-associated arthritis", "enthesitis"],
  "practice": {"name": "…", "address": {"line1": "…", "city": "Atlanta", "state": "GA", "zip": "30308"}},
  "distance_miles": 2.4,
  "telehealth": true,
  "accepting_referrals": true,
  "languages": ["English", "Igbo"],
  "avg_response_hours": 6
}
```

- **`distance_miles` is demo-only.** In Part 2 it's deleted from the schema and computed instead.
- **Keep `practice.address`** even though the demo ignores it. It's what Part 2 geocodes.
- **All entries are synthetic.** Don't add real people or real addresses.

### New SQLite tables (add to `SCHEMA` in `db.py`)

```sql
CREATE TABLE IF NOT EXISTS referrals (
    id              TEXT PRIMARY KEY,
    from_hcp_id     TEXT NOT NULL REFERENCES hcps(id),
    to_provider_id  TEXT NOT NULL,              -- id from the directory fixture
    type            TEXT NOT NULL,              -- advice | referral
    status          TEXT NOT NULL DEFAULT 'sent', -- sent | accepted | declined | completed | cancelled
    urgency         TEXT NOT NULL DEFAULT 'routine', -- routine | soon | urgent
    patient_id      TEXT REFERENCES patients(id),    -- referral type only
    case_id         TEXT REFERENCES cases(id),       -- advice type (de-identified)
    reason          TEXT NOT NULL,
    outcome         TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_messages (
    id           TEXT PRIMARY KEY,
    referral_id  TEXT NOT NULL REFERENCES referrals(id),
    sender       TEXT NOT NULL,     -- hcp id or directory provider id
    body         TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_from ON referrals(from_hcp_id);
CREATE INDEX IF NOT EXISTS idx_ref_to ON referrals(to_provider_id);
CREATE INDEX IF NOT EXISTS idx_msg_ref ON referral_messages(referral_id, created_at);
```

**Allowed status transitions** (anything else returns 409):
`sent → accepted | declined | cancelled`, `accepted → completed | cancelled`.

---

## 7. API

All routes go in a new router, `app/referrals/routes.py`, registered in `main.py` with `app.include_router(router)`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/referrals/directory` | Filtered, ranked list (params in §3, plus `hcp_id` = requester, default `hcp_demo`, and `question`) |
| GET | `/referrals/specialties` | Facet counts |
| GET | `/referrals/providers/{provider_id}` | One provider's full profile |
| POST | `/referrals` | Create an advice request or referral (creates the thread) |
| GET | `/referrals?hcp_id=…` or `?provider_id=…` | Sent by a doctor / received by a provider, with `message_count` and `last_message_at` |
| GET | `/referrals/{id}?viewer=…` | Referral, messages, the de-identified case (advice), or the patient (referral, once accepted) |
| POST | `/referrals/{id}/status` | `{status, actor, outcome?, feed_network?, final_diagnosis?, treatment_used?}`. Enforces transitions and who may make each change |
| GET | `/referrals/{id}/messages?viewer=…&since=ISO` | Poll for new messages |
| POST | `/referrals/{id}/messages` | `{sender, body}`. Rejects identifiers with 422, and closed threads with 409 |
| POST | `/referrals/{id}/simulate-reply` | **Demo only** (`PCX_DEMO=1`, on by default): posts a reply as the provider |

**Who can do what:** only the recipient can accept or decline, only the sender can cancel, and either participant can complete. Completing requires `outcome`. With `feed_network: true` and a `final_diagnosis`, the case is resolved with consent and indexed, so the **next** doctor with a similar patient finds it. A doctor's own cases are excluded from their own similar-case search.

### Example: directory with case-aware mode

`GET /referrals/directory?patient_id=pat_…&sort=best`

```json
{
  "proximity_source": "hardcoded",
  "origin_hcp_id": "hcp_demo",
  "applied_filters": {"specialty": ["Dermatology", "Rheumatology"], "suggested_specialties": ["Dermatology", "Rheumatology"],
                      "accepting": true, "include_telehealth": true},
  "total": 6,
  "results": [
    {
      "provider": {"id": "ref_001", "name": "Dr. Maya Okonkwo", "credentials": "MD", "role": "physician",
                   "specialty": "Rheumatology", "subspecialty": "Inflammatory arthritis",
                   "practice": {"name": "…", "city": "Atlanta", "state": "GA"}, "telehealth": true},
      "distance_miles": 2.4,
      "distance_band": "nearby",
      "score": 0.81,
      "score_breakdown": {"case_relevance": 0.74, "specialty_fit": 0.7, "proximity": 0.95, "responsiveness": 0.88, "role_fit": 1.0},
      "reasons": ["Focus on biologic-associated arthritis, enthesitis", "2.4 mi · Telehealth available", "Usually replies within ~6h"]
    }
  ]
}
```

In lists, return only city and state. The full street address is shown on the provider detail endpoint.

### Example: create

```json
POST /referrals
{"from_hcp_id": "hcp_demo", "to_provider_id": "ref_001", "type": "advice",
 "patient_id": "pat_…", "reason": "New enthesitis on dupilumab. Stop the biologic or switch?",
 "urgency": "routine"}
```

- **For `type: "advice"`,** the server de-identifies the patient's case (same helper as find-similar), stores it as a case, and sets `case_id`. It then posts the de-identified summary as the first message. The patient's name never goes into an advice thread.
- **For `type: "referral"`,** the server stores `patient_id`. See Privacy.

---

## 8. Chat

- **Polling for the hackathon:** the frontend calls `GET /referrals/{id}/messages?since=<last created_at>` every 3–5 seconds while the thread is open. It's simple and reliable on bad Wi-Fi. WebSockets can come later.
- **Demo responder (optional, makes the demo feel alive):** directory providers aren't real users, so add `POST /referrals/{id}/simulate-reply`. It generates a plausible reply with the existing `llm.complete_json`, with a canned fallback if there's no API key, and posts it as the provider. Hide the button outside demo mode (`PCX_DEMO=1`).
- **Notifications are in-app only:** e.g. an unread-count endpoint or a flag on the inbox. **No SMS, no Twilio.** SMS is banned by the hackathon rules.

---

## 9. Privacy

- **Advice threads are de-identified,** exactly like the peer case exchange. Run every message through `deid.regex_pass` and reject a message with 422 if it finds identifiers. This mirrors `POST /cases/{id}/responses`.
- **Referrals are a treatment handoff between providers.** HIPAA generally permits disclosing PHI to another provider for treatment. Still, for the hackathon:
  - All patients are synthetic.
  - Store only `patient_id`, not a copy of the record.
  - Show the receiving provider the patient summary only after they **accept**.
  - Before real use, confirm the handoff design with a compliance or privacy reviewer.
- **Only the involved parties can view a thread:** the sender and the recipient. In the demo, check that `hcp_id` matches `from_hcp_id`, or that the sender is the provider. Real auth comes from DocUpdate's NPI and Persona login.

---

## 10. Tests (add `tests/test_referrals.py`)

- [ ] The fixture loads, and every `specialty` and `role` is in the taxonomy lists.
- [ ] `specialty=Rheumatology` returns only rheumatology providers (4 in the fixture, all accepting).
- [ ] `accepting=true` hides `ref_007`, and `accepting=false` shows it.
- [ ] `max_distance=25&include_telehealth=false` hides `ref_015` (248 mi). With `include_telehealth=true`, it's kept (telehealth).
- [ ] `sort=distance` returns ascending distances. Two identical requests return **identical** results, which is what makes the demo repeatable.
- [ ] Case-aware mode with Maria Lopez's `patient_id` suggests Dermatology and Rheumatology and ranks `ref_001` or `ref_003` near the top.
- [ ] An unknown `specialty` returns 422 listing the valid values.
- [ ] An advice referral stores a `case_id` and no `patient_id`, and the patient's name doesn't appear in any message.
- [ ] A message containing a phone number is rejected with 422.
- [ ] Status transitions: `sent→completed` returns 409, and `sent→accepted→completed` succeeds.
- [ ] Every directory response has `"proximity_source": "hardcoded"`.

---

## 11. Build checklist (Part 1)

1. `backend/fixtures/referral_directory.json`: copy it in from this handoff.
2. `app/referrals/taxonomy.py`: the specialty and role lists.
3. `app/referrals/directory.py`: load and validate the fixture, cache provider embeddings, then filter, rank, and build reasons.
4. `app/referrals/proximity.py`: `HardcodedProximity` and `get_proximity()`.
5. `db.py`: the two new tables and their CRUD helpers.
6. `app/referrals/routes.py`: the endpoints in §7, registered in `main.py`.
7. Refactor: move the "patient → de-identified structured case" logic out of `find_similar` in `main.py` into a shared helper that both features use.
8. `tests/test_referrals.py`: the tests in §10.
9. README: add the new endpoints to the API table.

---

# Part 2: Real proximity (after the hackathon)

Goal: replace `HardcodedProximity` with a real calculation **without changing any API response shapes.** Only `proximity_source` changes (e.g. `"haversine"`), and `origin_hcp_id` starts to matter.

### Step 1: know where everyone is (latitude/longitude)

We need coordinates for both ends: the requesting doctor and each provider. Options that don't need Google, from simplest to most precise:

| Option | Precision | Cost / limits | Use for |
|---|---|---|---|
| **ZIP centroid table.** The US Census **ZCTA Gazetteer file** lists an internal point (latitude/longitude) for each ZIP code area | Roughly town or neighborhood level, usually good enough for "in your area" | Free, public domain, a one-time download, works offline | **Start here.** One small table lookup, no API calls |
| **US Census Geocoder API** | Street address | Free, no API key, offers batch geocoding | Upgrading providers from ZIP to exact address |
| **OpenStreetMap Nominatim** | Street address | Free, but the public server has a strict usage policy (about 1 request per second, no bulk jobs). Self-host for volume | A fallback if the Census geocoder misses an address |

Geocode **once**, when a provider is added or their address changes, and store `lat` and `lng` on the provider. **Never geocode per request.**

### Step 2: compute the distance

Straight-line (great-circle) distance with the haversine formula is plenty for ranking:

```python
from math import asin, cos, radians, sin, sqrt

def haversine_miles(lat1, lng1, lat2, lng2) -> float:
    lat1, lng1, lat2, lng2 = map(radians, (lat1, lng1, lat2, lng2))
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 3958.8 * 2 * asin(sqrt(a))   # Earth radius in miles


class HaversineProximity:
    name = "haversine"
    def __init__(self, locate):          # locate(entity) -> (lat, lng) | None
        self.locate = locate
    def distance_miles(self, origin_hcp_id, provider):
        a, b = self.locate(origin_hcp_id), self.locate(provider)
        return round(haversine_miles(*a, *b), 1) if a and b else None
```

**Performance:** with thousands of providers, first apply a cheap bounding-box pre-filter in SQL (latitude/longitude within about ±1°), then run haversine on what's left. Later options: SQLite's R-tree module, or PostGIS if we move to Postgres.

**Drive time instead of miles** (optional, later): self-host **OSRM**, an open-source routing engine built on OpenStreetMap data, and call its table service for the top ~20 results only.

### Step 3: where is the requesting doctor?

Use this order:
1. The practice address on their profile. DocUpdate has it from onboarding and NPI data. Geocode it once.
2. The device location, **only with explicit permission,** for doctors who work at several sites.
3. Fall back to the ZIP centroid of their practice ZIP code.

### Step 4: replace the fixture with real provider data

- **Public NPI data:** the **NPPES NPI Registry**, run by CMS, has a free public API. It returns each provider's practice address and **NUCC taxonomy codes**, which is how we'd map to `specialty` and `role` for real. Build a mapping table from NUCC codes to our specialty list.
- **Opt-in data:** accepting referrals, telehealth, languages, and response times aren't in NPPES. Providers set them on their profiles, and response time is measured from actual thread activity.
- **The Impiricus and DocUpdate HCP network** is the natural source of profiles for providers already on the platform. That's also where `hcp_id` links the directory to the peer network.

### Step 5: rules the real version must handle

- **State licensure for telehealth.** A clinician generally has to be licensed in the patient's state to treat them, including over telehealth. When `type=referral` and the provider is far away, filter by licensure state, not just the telehealth flag. Advice between clinicians is a different situation, but confirm with compliance.
- **Insurance network matching** is out of scope for now. It's the next thing real users will ask for.
- **Stale data:** show "last verified" on provider profiles, and re-check addresses periodically against NPPES.

### Migration checklist

1. Add `lat`, `lng`, and `geocode_source` columns (`zip_centroid` | `census` | `nominatim`) and a `geocoded_at` timestamp to the providers table (the fixture moves into the database).
2. A one-off script geocodes every provider: ZIP centroid first, then Census for exact addresses.
3. Implement `HaversineProximity`, then switch with `PCX_PROXIMITY=haversine`.
4. Remove `distance_miles` from the fixture and schema.
5. Update the tests: distances now depend on the origin. Add two origins and check the ordering flips.
6. Add the licensure filter for far-away referrals.
