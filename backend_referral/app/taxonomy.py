"""Canonical specialty and role names used by referral search.

Keep these values aligned with the provider directory fixture and the case
structuring pipeline when that pipeline is integrated into the backend app.
"""

SPECIALTIES = [
    "Dermatology",
    "Rheumatology",
    "Gastroenterology",
    "Oncology",
    "Endocrinology",
    "Pulmonology",
    "Neurology",
    "Internal Medicine",
    "Clinical Pharmacy",
]

ROLES = [
    "physician",
    "nurse_practitioner",
    "physician_assistant",
    "nurse",
    "pharmacist",
]

URGENCIES = ["routine", "soon", "urgent"]
REFERRAL_TYPES = ["advice", "referral"]

# Roles that can take over a patient's care in a formal referral.
PRESCRIBING_ROLES = {
    "physician",
    "nurse_practitioner",
    "physician_assistant",
}
