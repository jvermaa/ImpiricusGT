"""Condition code to specialty. Shared by fixture checks and referral matching."""

FALLBACK_SPECIALTY = "Primary Care"

CODE_SPECIALTY = {
    "I10": "Cardiology",
    "I50.9": "Cardiology",
    "E03.9": "Endocrinology",
    "E11.9": "Endocrinology",
    "J45.909": "Pulmonology",
    "J44.9": "Pulmonology",
    "L40.9": "Dermatology",
    "L20.9": "Dermatology",
    "M06.9": "Rheumatology",
    "M10.9": "Rheumatology",
    "K52.9": "Gastroenterology",
    "K21.9": "Gastroenterology",
    "G43.909": "Neurology",
    "G40.909": "Neurology",
    "D50.9": FALLBACK_SPECIALTY,
    "E78.5": FALLBACK_SPECIALTY,
}


def specialty_for_code(code: str) -> str:
    return CODE_SPECIALTY.get(code, FALLBACK_SPECIALTY)
