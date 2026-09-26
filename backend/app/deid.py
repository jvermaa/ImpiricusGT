"""De-identification of free-text case descriptions.

Pipeline:
  1. Deterministic regex pass for HIPAA Safe Harbor identifier types that have a
     recognizable shape (dates, phones, emails, SSNs, MRNs, URLs, IPs, addresses,
     ZIP codes, names after titles, facilities, US states). Exact ages are
     generalized to bands; ages over 89 become "90+" as Safe Harbor requires.
  2. Optional Claude pass that only *points at* residual identifiers (names,
     places, employers, rare personal details). We replace the exact spans it
     returns; the model never rewrites the clinical text itself.
  3. Re-identification risk warnings the doctor sees before confirming.

Nothing here is persisted: the /deidentify endpoint is stateless, and only the
doctor-confirmed redacted text is ever stored.
"""
import re

from . import llm

US_STATES = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
             "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
             "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
             "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana",
             "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
             "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
             "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
             "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"]

MONTHS = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"

# (category, compiled pattern, replacement). Order matters: specific before generic.
PATTERNS = [
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"), "[EMAIL]"),
    ("URL", re.compile(r"\bhttps?://\S+|\bwww\.\S+", re.I), "[URL]"),
    ("IP", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"), "[IP]"),
    ("SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[SSN]"),
    ("MRN", re.compile(r"\b(?:MRN|medical record(?: number)?|acct|account)\s*(?:#|no\.?|number)?\s*[:#]?\s*[A-Z0-9-]{4,}\b", re.I), "[MRN]"),
    ("PHONE", re.compile(r"(?:\+1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b"), "[PHONE]"),
    ("DATE", re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b"), "[DATE]"),
    ("DATE", re.compile(rf"\b{MONTHS}\.?\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?\b", re.I), "[DATE]"),
    ("DATE", re.compile(rf"\b{MONTHS}\.?\s+\d{{4}}\b", re.I), "[DATE]"),
    ("ADDRESS", re.compile(r"\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Parkway|Pkwy)\b\.?"), "[ADDRESS]"),
    ("ZIP", re.compile(r"\b(?:[A-Z]{2}\s+)\d{5}(?:-\d{4})?\b|\bzip(?:\s*code)?\s*:?\s*\d{5}(?:-\d{4})?\b", re.I), "[ZIP]"),
    ("FACILITY", re.compile(r"\b(?:[A-Z][a-z]+\s){1,4}(?:Hospital|Medical Center|Clinic|Health System|Healthcare)\b"), "[FACILITY]"),
    ("NAME", re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?"), "[NAME]"),
    ("NAME", re.compile(r"\b(?:named|name is|called)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?"), "named [NAME]"),
    ("LOCATION", re.compile(r"\b(?:" + "|".join(US_STATES) + r")\b"), "[LOCATION]"),
]

AGE_PATTERNS = [
    re.compile(r"\b(\d{1,3})\s*[- ]?\s*(?:years?|yrs?|yr)[- ]?old\b", re.I),
    re.compile(r"\b(\d{1,3})\s*(?:yo|y/o|y\.o\.)\b", re.I),
    re.compile(r"\b(?:age|aged)\s*:?\s*(\d{1,3})\b", re.I),
    re.compile(r"(?<![\d.])(\d{1,2})\s?(?:M|F)\b"),  # "52 F", "34M" (not temperatures, see below)
]

RISK_PHRASES = {
    "rare_or_unique": re.compile(r"\b(?:only (?:known )?case|first (?:reported|known) case|one of (?:only|a handful)|extremely rare|ultra[- ]rare)\b", re.I),
    "occupation": re.compile(r"\b(?:works as|employed as|professional (?:athlete|player)|mayor|senator|celebrity|famous|news(?:paper)?|on tv)\b", re.I),
    "event": re.compile(r"\b(?:accident on|shooting|fire at|made headlines|viral video)\b", re.I),
}


def age_band(age: int) -> str:
    if age >= 90:
        return "90+"
    if age < 18:
        return "pediatric (<18)"
    return f"{(age // 10) * 10}s"


def _generalize_ages(text: str, removed: list[dict]) -> tuple[str, str | None]:
    first_band = None

    def repl(m: re.Match) -> str:
        nonlocal first_band
        age = int(m.group(1))
        before = m.string[max(0, m.start() - 15):m.start()].lower()
        if age > 120 or "temp" in before or "fever" in before or "\u00b0" in before:
            return m.group(0)  # a lab value or temperature, not an age
        band = age_band(age)
        first_band = first_band or band
        out = f"[AGE: {band}]"
        tail = m.group(0)[-1]
        if tail in "MF" and not m.group(0)[-2].isalpha():  # "52 F" / "34M" shorthand keeps sex
            out += " female" if tail == "F" else " male"
        removed.append({"category": "AGE", "original_length": len(m.group(0)), "replacement": out})
        return out

    for p in AGE_PATTERNS:
        text = p.sub(repl, text)
    return text, first_band


def regex_pass(text: str) -> tuple[str, list[dict], str | None]:
    removed: list[dict] = []
    for category, pattern, replacement in PATTERNS:
        def repl(m: re.Match, c=category, r=replacement) -> str:
            removed.append({"category": c, "original_length": len(m.group(0)), "replacement": r})
            return r
        text = pattern.sub(repl, text)
    text, band = _generalize_ages(text, removed)
    return text, removed, band


LLM_SYSTEM = """You are a HIPAA de-identification auditor. You receive clinical text that has ALREADY
been partially redacted (placeholders look like [NAME], [DATE], [AGE: 50s]).
Find any REMAINING direct identifiers: person names, nicknames, specific towns/cities/counties,
street names, employers, schools, specific named events, unique personal details, account or
device numbers. Do NOT flag medical terms, drug names, eponymous diseases (e.g. "Still's disease",
"Crohn's"), lab values, or generic places like "the ER".
Return {"identifiers": [{"text": "<exact substring as it appears>", "category": "NAME|LOCATION|EMPLOYER|DATE|OTHER"}]}.
Return an empty list if none remain."""


def llm_pass(text: str) -> tuple[str, list[dict]]:
    result = llm.complete_json(LLM_SYSTEM, text, max_tokens=600)
    removed: list[dict] = []
    if not result:
        return text, removed
    for item in result.get("identifiers", []) or []:
        span = (item.get("text") or "").strip()
        if len(span) < 2 or span.startswith("[") or span not in text:
            continue
        cat = (item.get("category") or "OTHER").upper()
        text = text.replace(span, f"[{cat}]")
        removed.append({"category": cat, "original_length": len(span), "replacement": f"[{cat}]",
                        "source": "llm"})
    return text, removed


def risk_warnings(raw: str, age_band_value: str | None) -> list[str]:
    warnings = []
    if age_band_value == "90+":
        warnings.append("Patient is 90 or older; age is shown only as '90+'.")
    if RISK_PHRASES["rare_or_unique"].search(raw):
        warnings.append("Case is described as rare or unique. Rare presentations can identify a "
                        "patient even without names; consider generalizing distinguishing details.")
    if RISK_PHRASES["occupation"].search(raw):
        warnings.append("Occupation or public profile mentioned. Remove it unless clinically essential.")
    if RISK_PHRASES["event"].search(raw):
        warnings.append("A specific real-world event is mentioned, which could identify the patient.")
    return warnings


def scrub_known(text: str, known: list[str]) -> tuple[str, int]:
    """Remove identifiers we already know (e.g. the patient's name from their record),
    token by token, so 'Maria', 'Lopez' and 'Ms. Lopez' are all caught."""
    n = 0
    tokens = {t for k in known for t in re.split(r"[\s,]+", k or "") if len(t) >= 2}
    for tok in sorted(tokens, key=len, reverse=True):
        text, k = re.subn(rf"\b{re.escape(tok)}\b", "[NAME]", text, flags=re.I)
        n += k
    text = re.sub(r"\[NAME\](?:\s+\[NAME\])+", "[NAME]", text)
    return text, n


def deidentify(raw_text: str, use_llm: bool = True, known_identifiers: list[str] | None = None) -> dict:
    text, removed, band = regex_pass(raw_text)
    if known_identifiers:
        text, n = scrub_known(text, known_identifiers)
        removed += [{"category": "NAME", "original_length": 0, "replacement": "[NAME]"}] * n
    llm_used = False
    if use_llm and llm.available():
        text, extra = llm_pass(text)
        removed += extra
        llm_used = True
    summary: dict[str, int] = {}
    for r in removed:
        summary[r["category"]] = summary.get(r["category"], 0) + 1
    return {
        "redacted_text": text,
        "removed_counts": summary,
        "age_band": band,
        "warnings": risk_warnings(raw_text, band),
        "llm_audit_used": llm_used,
        "requires_confirmation": True,
    }
