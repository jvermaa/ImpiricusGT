"""Seed the network with SYNTHETIC data for the demo.

  python -m scripts.seed            # seed (idempotent: wipes and rebuilds)

Everything here is fabricated and flagged is_synthetic=1. In production the HCP
profiles would come from DocUpdate/Impiricus (NPI, specialty, prescribing
patterns at drug-class level, authored articles, council membership) and the
cases from doctors who opted in.
"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import config, db, vectorstore  # noqa: E402
from app.structuring import fallback_structure  # noqa: E402

random.seed(42)

SPECIALTIES = {
    "Dermatology": {
        "subs": ["Medical dermatology", "Inflammatory skin disease", "Pediatric dermatology", "Dermatopathology"],
        "focus": ["atopic dermatitis", "biologic therapy", "hidradenitis suppurativa", "psoriasis",
                  "drug eruptions", "cutaneous lupus", "alopecia areata", "rosacea"],
        "drugs": ["IL-4/IL-13 inhibitors", "JAK inhibitors", "IL-17 inhibitors", "topical corticosteroids",
                  "TNF inhibitors", "retinoids"],
    },
    "Rheumatology": {
        "subs": ["Inflammatory arthritis", "Connective tissue disease", "Myositis", "Vasculitis"],
        "focus": ["psoriatic arthritis", "systemic sclerosis", "adult-onset Still's disease",
                  "inflammatory myopathy", "lupus", "seronegative spondyloarthropathy", "sarcoidosis",
                  "drug-induced autoimmunity"],
        "drugs": ["TNF inhibitors", "IL-6 inhibitors", "IL-17 inhibitors", "methotrexate",
                  "IL-1 inhibitors", "IVIG", "JAK inhibitors"],
    },
    "Gastroenterology": {
        "subs": ["Motility", "IBD", "Pancreatobiliary", "General GI"],
        "focus": ["bile acid malabsorption", "celiac disease", "IBS", "immune-mediated colitis",
                  "pancreatitis", "chronic diarrhea", "IBD"],
        "drugs": ["GC-C agonists", "bile acid sequestrants", "mesalamine", "anti-integrins",
                  "pancreatic enzymes"],
    },
    "Oncology": {
        "subs": ["Immuno-oncology", "Thoracic oncology", "Melanoma", "Breast oncology"],
        "focus": ["immune-related adverse events", "checkpoint inhibitor toxicity", "hypophysitis",
                  "immune-mediated colitis", "melanoma", "lung cancer"],
        "drugs": ["PD-1 inhibitors", "CTLA-4 inhibitors", "high-dose corticosteroids", "targeted therapy"],
    },
    "Endocrinology": {
        "subs": ["Adrenal", "Pituitary", "Diabetes", "Thyroid"],
        "focus": ["adrenal insufficiency", "hypophysitis", "GLP-1 therapy", "hyponatremia",
                  "immune-related endocrinopathy"],
        "drugs": ["GLP-1 receptor agonists", "hydrocortisone replacement", "SGLT2 inhibitors",
                  "levothyroxine"],
    },
    "Pulmonology": {
        "subs": ["Interstitial lung disease", "Sarcoidosis", "Asthma"],
        "focus": ["sarcoidosis", "Lofgren syndrome", "interstitial lung disease", "hilar adenopathy"],
        "drugs": ["inhaled corticosteroids", "antifibrotics", "biologics for asthma"],
    },
    "Neurology": {
        "subs": ["Neuromuscular", "General neurology"],
        "focus": ["immune-mediated necrotizing myopathy", "statin myopathy", "neuropathy", "myasthenia"],
        "drugs": ["IVIG", "corticosteroids", "rituximab"],
    },
    "Internal Medicine": {
        "subs": ["Hospital medicine", "Primary care", "Diagnostic medicine"],
        "focus": ["undiagnosed fever", "diagnostic dilemmas", "polypharmacy", "fatigue work-up",
                  "adrenal insufficiency", "GLP-1 therapy"],
        "drugs": ["GLP-1 receptor agonists", "statins", "thiazide diuretics", "SGLT2 inhibitors"],
    },
}
SPECIALTY_WEIGHTS = {"Dermatology": 30, "Rheumatology": 28, "Gastroenterology": 26, "Oncology": 26,
                     "Endocrinology": 20, "Pulmonology": 18, "Neurology": 16, "Internal Medicine": 36}

FIRST = ["A.", "B.", "C.", "D.", "E.", "F.", "G.", "H.", "J.", "K.", "L.", "M.", "N.", "P.", "R.", "S.", "T."]
LAST = ["Rivera", "Okafor", "Chen", "Patel", "Nguyen", "Haddad", "Kowalski", "Mensah", "Ibrahim",
        "Silva", "Novak", "Tanaka", "Khan", "Moreau", "Adeyemi", "Larsen", "Gupta", "Reyes",
        "Schmidt", "Oduya", "Park", "Rossi", "Mahmoud", "Lindqvist", "Ortiz", "Bose", "Ferreira"]
STATES = ["GA", "NY", "CA", "TX", "FL", "IL", "OH", "WA", "NC", "MA", "AZ", "MI", "PA", "CO"]

# Synthetic resolved cases: (specialty, narrative template, final diagnosis).
# {age}, {sex}, {extra} are varied per instance.
CASES = [
    ("Dermatology", "{age} year old {sex} with moderate-to-severe atopic dermatitis, skin clear on dupilumab for 6 months, now new pain at the heels and knees with morning stiffness. Enthesitis on exam, RF and CCP negative. {extra} Is this related to the biologic?",
     "Dupilumab-associated seronegative arthritis/enthesitis"),
    ("Gastroenterology", "{age} year old {sex} with chronic watery diarrhea starting a few months after cholecystectomy. Stool infectious work-up negative, colonoscopy with normal biopsies. {extra} Loperamide only partly helps. What am I missing?",
     "Bile acid malabsorption"),
    ("Rheumatology", "{age} year old {sex} with daily quotidian fevers, salmon-colored evanescent rash, arthralgias and sore throat. Ferritin markedly elevated, ANA and RF negative, cultures negative. {extra} Infectious disease work-up unrevealing.",
     "Adult-onset Still's disease"),
    ("Oncology", "{age} year old {sex} with metastatic melanoma on combination checkpoint inhibitor therapy, now severe fatigue, headache and hyponatremia. {extra} Low morning cortisol and low ACTH. Thoughts on work-up?",
     "Immune checkpoint inhibitor hypophysitis"),
    ("Internal Medicine", "{age} year old {sex} started on semaglutide for type 2 diabetes, dose recently increased, now epigastric pain radiating to the back with nausea. Lipase elevated. {extra} Gallbladder ultrasound pending.",
     "GLP-1 receptor agonist associated acute pancreatitis"),
    ("Dermatology", "{age} year old {sex} with recurrent painful nodules and draining tunnels in the axillae and groin, repeatedly treated as abscesses with antibiotics. {extra} Scarring present. How would you approach this?",
     "Hidradenitis suppurativa"),
    ("Rheumatology", "{age} year old {sex} with Raynaud phenomenon, puffy fingers, new dysphagia and skin tightening proximal to the MCPs. {extra} ANA positive. Concerned about underlying connective tissue disease.",
     "Systemic sclerosis"),
    ("Gastroenterology", "{age} year old {sex} with IBS-C symptoms refractory to linaclotide, also iron deficiency anemia and bloating. {extra} No GI bleeding reported. Anything else to check before escalating?",
     "Celiac disease"),
    ("Oncology", "{age} year old {sex} on pembrolizumab for lung cancer, now 6 to 8 watery stools per day with abdominal cramping. Stool infectious studies negative. {extra} How aggressive should treatment be?",
     "Immune-mediated colitis from checkpoint inhibitor"),
    ("Dermatology", "{age} year old {sex} with an annular scaly rash on sun-exposed arms and upper back a few months after starting hydrochlorothiazide for hypertension. {extra} Anti-Ro positive. Drug related?",
     "Drug-induced subacute cutaneous lupus (hydrochlorothiazide)"),
    ("Endocrinology", "{age} year old {sex} with progressive fatigue, weight loss, salt craving, skin hyperpigmentation, hypotension and hyponatremia with mild hyperkalemia. {extra} Seen several times for vague symptoms.",
     "Primary adrenal insufficiency (Addison's disease)"),
    ("Rheumatology", "{age} year old {sex} with mild scalp and elbow psoriasis, now a swollen sausage-like finger and heel pain. {extra} Dermatology considers the skin disease mild. Could this still be significant joint disease?",
     "Psoriatic arthritis"),
    ("Pulmonology", "{age} year old {sex} with fever, bilateral ankle arthritis, tender red nodules on the shins and bilateral hilar lymphadenopathy on chest X-ray. {extra} Concern for lymphoma raised.",
     "Lofgren syndrome (acute sarcoidosis)"),
    ("Neurology", "{age} year old {sex} with progressive proximal muscle weakness that persisted months after stopping atorvastatin. Creatine kinase in the thousands. {extra} Not improving off the statin, why?",
     "Anti-HMGCR immune-mediated necrotizing myopathy"),
]
# What the resolving doctor did, and what happened. Synthetic, written to reflect
# common published management; outcomes vary across the 4 instances of each case.
TREATMENT_OUTCOME = {
    "Dupilumab-associated seronegative arthritis/enthesitis": (
        "NSAIDs; dupilumab stopped and switched to a JAK inhibitor after rheumatology review",
        ["Joint symptoms resolved within 8 weeks; skin stayed controlled",
         "Partial improvement on NSAIDs alone; resolved after switch"]),
    "Bile acid malabsorption": (
        "Trial of bile acid sequestrant (cholestyramine)",
        ["Stool frequency normalized within 2 weeks", "Marked improvement; switched to colesevelam for tolerability"]),
    "Adult-onset Still's disease": (
        "Systemic corticosteroids; IL-1 inhibitor (anakinra) added for steroid-dependent disease",
        ["Fevers resolved; tapered steroids successfully", "Remission on IL-1 inhibitor"]),
    "Immune checkpoint inhibitor hypophysitis": (
        "Physiologic hydrocortisone replacement; pituitary MRI; endocrine follow-up",
        ["Symptoms improved within days; immunotherapy continued", "Required long-term hydrocortisone"]),
    "GLP-1 receptor agonist associated acute pancreatitis": (
        "GLP-1 RA discontinued; IV fluids and supportive care; not rechallenged",
        ["Recovered without complications", "Recovered; switched to a non-incretin diabetes agent"]),
    "Hidradenitis suppurativa": (
        "Stopped repeated I&D; long-term doxycycline; escalated to a biologic for moderate-severe disease",
        ["Flare frequency fell substantially", "Good response to biologic plus surgical deroofing"]),
    "Systemic sclerosis": (
        "Calcium channel blocker for Raynaud; PPI for dysphagia; PFTs and echo to screen for ILD and PAH",
        ["Stable; ILD screening negative", "Early ILD found; started mycophenolate"]),
    "Celiac disease": (
        "tTG-IgA then duodenal biopsy to confirm; strict gluten-free diet; iron repletion",
        ["GI symptoms and anemia resolved in 3 months", "Improved; dietitian referral helped adherence"]),
    "Immune-mediated colitis from checkpoint inhibitor": (
        "Checkpoint inhibitor held; systemic corticosteroids; infliximab for steroid-refractory colitis",
        ["Resolved on steroids", "Steroid-refractory; responded to infliximab"]),
    "Drug-induced subacute cutaneous lupus (hydrochlorothiazide)": (
        "Hydrochlorothiazide stopped; topical corticosteroids; strict photoprotection",
        ["Rash cleared within 2 months", "Slow clearance; added hydroxychloroquine"]),
    "Primary adrenal insufficiency (Addison's disease)": (
        "Hydrocortisone plus fludrocortisone; stress-dose and sick-day education; medical alert ID",
        ["Energy and electrolytes normalized", "Stable on replacement"]),
    "Psoriatic arthritis": (
        "NSAIDs; escalated to a TNF or IL-17 inhibitor for dactylitis and enthesitis",
        ["Dactylitis resolved on biologic", "Good joint and skin response"]),
    "Lofgren syndrome (acute sarcoidosis)": (
        "NSAIDs and supportive care; serial chest imaging; no biopsy needed given classic triad",
        ["Self-limited; resolved within months", "Resolved; hilar nodes regressed on follow-up imaging"]),
    "Anti-HMGCR immune-mediated necrotizing myopathy": (
        "Anti-HMGCR antibody confirmed; corticosteroids plus IVIG; statins permanently avoided",
        ["Strength and CK improved over 3 months", "Needed methotrexate as steroid-sparing agent"]),
}

# The demo doctor's OWN patients (the "patient page"). Synthetic and identifiable on
# purpose, to show that names never leave this table.
DEMO_PATIENTS = [
    ("Maria Lopez", 52, "female",
     "Atopic dermatitis, skin clear on dupilumab for 5 months. Now new heel pain and knee stiffness "
     "every morning. Enthesitis on exam, RF and CCP negative.", ["dupilumab"],
     "Could this be related to the biologic?"),
    ("James Carter", 61, "male",
     "Progressive proximal muscle weakness that has continued for 4 months after stopping atorvastatin. "
     "Creatine kinase in the thousands.", ["metformin"], "Why is he not improving off the statin?"),
    ("Aisha Bello", 34, "female",
     "IBS-C symptoms not improving on linaclotide, plus iron deficiency anemia and bloating. "
     "No GI bleeding.", ["linaclotide", "ferrous sulfate"], "Anything else to check before escalating?"),
    ("Robert Nguyen", 67, "male",
     "Annular scaly rash on sun-exposed arms and upper back, started a few months after "
     "hydrochlorothiazide for hypertension.", ["hydrochlorothiazide", "amlodipine"], "Is this drug related?"),
    ("Elena Petrova", 38, "female",
     "Recurrent swelling of the lips and hands lasting 2 to 3 days, no hives, normal C4, not on an ACE "
     "inhibitor, antihistamines do not help.", [], "What should I test next?"),
]

EXTRAS = ["", "No relevant family history.", "Recent travel unremarkable.", "Symptoms worse over the last month.",
          "Previously healthy.", "Seen by two other clinicians without a diagnosis.", "Has type 2 diabetes.",
          "Former smoker."]
TREATMENTS_BY_DX = {
    "Bile acid malabsorption": ["loperamide"],
    "Celiac disease": ["linaclotide"],
    "Hidradenitis suppurativa": ["oral antibiotics", "incision and drainage"],
    "Psoriatic arthritis": ["topical corticosteroids"],
}


def make_hcps() -> list[dict]:
    hcps, used = [], set()
    for spec, n in SPECIALTY_WEIGHTS.items():
        meta = SPECIALTIES[spec]
        for _ in range(n):
            while True:
                name = f"Dr. {random.choice(FIRST)} {random.choice(LAST)}"
                if name not in used:
                    used.add(name)
                    break
            hcps.append({
                "id": db.new_id("hcp"),
                "display_name": name,
                "specialty": spec,
                "subspecialty": random.choice(meta["subs"]),
                "focus_areas": random.sample(meta["focus"], k=min(3, len(meta["focus"]))),
                "drug_classes": random.sample(meta["drugs"], k=min(3, len(meta["drugs"]))),
                "state": random.choice(STATES),
                "years_experience": random.randint(3, 30),
                "response_rate": round(random.uniform(0.3, 0.95), 2),
                "avg_response_hours": round(random.uniform(2, 48), 1),
                "cases_answered": 0,
                "accepting_cases": random.random() > 0.1,
                "is_synthetic": True,
            })
    return hcps


def main() -> None:
    import shutil
    if config.SQLITE_PATH.exists():
        config.SQLITE_PATH.unlink()
    shutil.rmtree(config.CHROMA_PATH, ignore_errors=True)
    vectorstore._client.cache_clear()
    db.init_db()

    demo = {"id": "hcp_demo", "display_name": "Dr. Demo (you)", "specialty": "Dermatology",
            "subspecialty": "Medical dermatology", "focus_areas": ["atopic dermatitis", "biologic therapy"],
            "drug_classes": ["IL-4/IL-13 inhibitors"], "state": "GA", "years_experience": 8,
            "response_rate": 0.8, "avg_response_hours": 6, "accepting_cases": True}
    hcps = [db.insert_hcp(demo)] + [db.insert_hcp(h) for h in make_hcps()]
    vectorstore.upsert_hcps(hcps)
    by_spec: dict[str, list[dict]] = {}
    for h in hcps:
        by_spec.setdefault(h["specialty"], []).append(h)

    n_cases = 0
    for spec, template, dx in CASES:
        # A small group of "go-to" experts resolves most cases of each type, so the
        # network shows realistic concentration of experience.
        experts = random.sample(by_spec[spec], k=2)
        for _ in range(4):
            age = random.randint(24, 78)
            sex = random.choice(["female", "male"])
            text = template.format(age=age, sex=sex, extra=random.choice(EXTRAS)).replace("  ", " ")
            band = f"{(age // 10) * 10}s"
            text = text.replace(f"{age} year old", f"[AGE: {band}]")
            structured = fallback_structure(text, band)
            structured["suspected_conditions"] = structured["suspected_conditions"] or []
            structured["treatments_tried"] = (structured["treatments_tried"]
                                              or TREATMENTS_BY_DX.get(dx, []))
            author = random.choice([h for h in hcps if h["specialty"] != spec and h["id"] != "hcp_demo"])
            resolver = random.choice(experts) if random.random() < 0.8 else random.choice(by_spec[spec])
            treatment, outcomes = TREATMENT_OUTCOME[dx]
            case = db.insert_case(author["id"], text, structured, consent_to_index=True,
                                  status="resolved", final_diagnosis=dx,
                                  resolved_by_hcp_id=resolver["id"],
                                  treatment_used=treatment, outcome=random.choice(outcomes))
            for peer in random.sample(by_spec[spec], k=2):
                if peer["id"] != resolver["id"]:
                    db.insert_response(case["id"], peer["id"], "Synthetic peer reply.")
            db.increment_answered(resolver["id"])
            vectorstore.upsert_case(case)
            n_cases += 1

    for name, age, sex, summary, meds, _q in DEMO_PATIENTS:
        db.insert_patient("hcp_demo", name, age, sex, summary, meds)

    print(f"Demo doctor: hcp_demo with {len(DEMO_PATIENTS)} patients.")
    print(f"Seeded {len(hcps)} synthetic HCPs and {n_cases} resolved cases. {vectorstore.counts()}")


if __name__ == "__main__":
    main()
