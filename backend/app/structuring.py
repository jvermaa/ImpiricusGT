"""Turn a de-identified narrative into a StructuredCase dict.

The structured form is what gets embedded and matched, so two doctors describing
the same presentation in different words still land near each other.
"""
import re

from . import llm

SPECIALTY_KEYWORDS = {
    "Dermatology": ["rash", "dermatitis", "eczema", "psoriasis", "plaque", "lesion", "pruritus",
                    "itch", "hidradenitis", "nodule", "urticaria", "dupilumab", "skin", "alopecia",
                    "photosensitiv"],
    "Rheumatology": ["arthritis", "arthralgia", "joint", "synovitis", "enthesitis", "dactylitis",
                     "lupus", "ana", "ferritin", "raynaud", "sclerosis", "myositis", "vasculitis",
                     "still", "stiffness", "creatine kinase", "ck "],
    "Gastroenterology": ["diarrhea", "constipation", "abdominal", "ibs", "colitis", "celiac",
                         "bloating", "lipase", "pancrea", "stool", "gi ", "crohn", "linaclotide",
                         "cholecystectomy", "dysphagia"],
    "Oncology": ["cancer", "tumor", "carcinoma", "melanoma", "lymphoma", "chemotherapy",
                 "pembrolizumab", "nivolumab", "checkpoint", "immunotherapy", "metasta"],
    "Endocrinology": ["thyroid", "adrenal", "cortisol", "hyponatremia", "glucose", "a1c",
                      "diabetes", "hyperpigmentation", "pituitary", "hypophysitis", "glp-1"],
    "Pulmonology": ["dyspnea", "cough", "hilar", "lymphadenopathy", "pulmonary", "lung",
                    "sarcoid", "wheez", "inhaler"],
    "Neurology": ["weakness", "neuropathy", "seizure", "headache", "numbness", "myopathy",
                  "tremor", "gait"],
    "Internal Medicine": ["fatigue", "fever", "weight loss", "hypotension", "statin"],
}

STRUCT_SYSTEM = """You structure de-identified clinical case descriptions for a physician peer-consult network.
Extract only what is stated; never invent findings. Keep placeholders like [AGE: 50s] out of fields.
Return:
{
  "age_band": "e.g. 50s, 90+, pediatric (<18), or null",
  "sex": "female|male|other|null",
  "chief_complaint": "short phrase",
    "symptoms": [{"name": "...", "duration": "... or null", "frequency": "... or null",
                                "onset": "gradual|sudden|... or null", "aggravating_factors": ["..."]}],
  "key_findings": ["symptoms, exam findings, labs, imaging"],
  "suspected_conditions": ["diagnoses the author is considering or asking about"],
  "treatments_tried": ["drugs or interventions already tried, with response if stated"],
    "past_medical_history": ["..."],
    "family_medical_history": ["..."],
    "current_medications": ["..."],
    "social_history": ["..."],
    "lab_results": ["..."],
    "pregnancy_status": "... or null",
    "immune_status": "... or null",
  "clinical_question": "what the author wants help with, one sentence",
  "specialty_hints": ["1-3 of: Dermatology, Rheumatology, Gastroenterology, Oncology, Endocrinology, Pulmonology, Neurology, Internal Medicine"],
  "search_terms": ["2-4 short medical search terms for literature and trial lookup"]
}"""


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.;!?])\s+|\n+", text)
    return [p.strip(" .;") for p in parts if len(p.strip()) > 3]


ADMIN_CUES = re.compile(r"\b(seen at|seen in|phone|lives|address|mrn|referred by|insurance|contact)\b", re.I)


def _clean(s: str) -> str:
    s = re.sub(r"\[AGE: ([^\]]+)\]", r"\1", s)            # keep the band as words
    s = re.sub(r"\[[A-Z]+(?::[^\]]*)?\]", "", s)          # drop other placeholders
    s = re.sub(r"\s*,\s*(,\s*)+", ", ", s)
    return re.sub(r"\s{2,}", " ", s).strip(" ,.;")


def _clinical(s: str) -> bool:
    """Sentence carries clinical content (not admin boilerplate or placeholder residue)."""
    if ADMIN_CUES.search(s):
        return False
    if re.search(r"\d", s) and len(re.findall(r"[A-Za-z]{2,}", s)) >= 1:
        return True  # short vitals/labs like "Temp 99 F", "CK 8000"
    return len(re.findall(r"[A-Za-z]{3,}", s)) >= 3


def fallback_structure(text: str, age_band: str | None) -> dict:
    low = text.lower()
    sex = None
    if re.search(r"\b(?:female|woman|women|\d{1,2}\s?F|she|her)\b", text, re.I):
        sex = "female"
    elif re.search(r"\b(?:male|man|\d{1,2}\s?M|he|his)\b", text, re.I):
        sex = "male"

    hints = sorted(SPECIALTY_KEYWORDS,
                   key=lambda s: -sum(low.count(k) for k in SPECIALTY_KEYWORDS[s]))
    hints = [h for h in hints if any(k in low for k in SPECIALTY_KEYWORDS[h])][:3]

    raw_sents = _sentences(text)
    sents = [_clean(s) for s in raw_sents]
    sents = [s for s in sents if s and _clinical(s)]
    question = next((_clean(s) for s in raw_sents if s.rstrip().endswith("?")), "") or next(
        (s for s in sents if re.search(r"\b(any thoughts|ideas|what am i missing|how would|should i)\b", s, re.I)), "")
    tried = [s for s in sents if re.search(
        r"\b(tried|failed|started|despite|treated with|no response|refractory to|"
        r"on \w+(?:mab|nib|tide|zide|statin|olone|sone|cept))\b", s, re.I)]
    considering = [s for s in sents if re.search(r"\b(concern(ed)? for|consider|ruled out|r/o|differential|suspect)\b", s, re.I)]
    findings = [s for s in sents if s not in tried and s != question and s not in considering][:6]

    symptoms = [{"name": s[:240], "duration": None, "frequency": None,
                 "onset": None, "aggravating_factors": []} for s in findings[:6]]

    words = re.findall(r"[a-z][a-z-]{4,}", low)
    medical = [w for w in words if any(w.startswith(k.strip()[:6]) for ks in SPECIALTY_KEYWORDS.values() for k in ks)]
    search_terms = list(dict.fromkeys(medical))[:4]

    return {
        "age_band": age_band,
        "sex": sex,
        "chief_complaint": next((s for s in sents if s != question), "")[:140],
        "symptoms": symptoms,
        "key_findings": findings,
        "suspected_conditions": considering[:3],
        "treatments_tried": tried[:4],
        "past_medical_history": [],
        "family_medical_history": [],
        "current_medications": [],
        "social_history": [],
        "lab_results": [],
        "pregnancy_status": None,
        "immune_status": None,
        "clinical_question": question,
        "specialty_hints": hints or ["Internal Medicine"],
        "search_terms": search_terms,
        "structured_by": "rules",
    }


def structure_case(redacted_text: str, age_band: str | None) -> dict:
    result = llm.complete_json(STRUCT_SYSTEM, redacted_text, max_tokens=900)
    if not result:
        return fallback_structure(redacted_text, age_band)
    base = fallback_structure(redacted_text, age_band)
    for k in base:
        if k in result and result[k] not in (None, "", []):
            base[k] = result[k]
    base["age_band"] = base.get("age_band") or age_band
    base["structured_by"] = "llm"
    return base
