import type { DoctorProfile } from './chatMock';
import type { PatientProfile, SymptomEntry } from './patientMock';

type SpecializationRule = {
  specialization: string;
  keywords: string[];
};

const SPECIALIZATION_RULES: SpecializationRule[] = [
  {
    specialization: 'Cardiology',
    keywords: ['dyspnea', 'arrhythmia', 'orthopnea', 'palpitations', 'edema', 'chf', 'heart'],
  },
  {
    specialization: 'Pulmonology',
    keywords: ['wheez', 'cough', 'chest tightness', 'asthma', 'shortness of breath'],
  },
  {
    specialization: 'Neurology',
    keywords: ['tremor', 'bradykinesia', 'vertigo', 'headache', 'neurolog'],
  },
  {
    specialization: 'Rheumatology',
    keywords: ['stiffness', 'joint', 'autoimmune', 'inflammation'],
  },
  {
    specialization: 'Endocrinology',
    keywords: ['glucose', 'diabetes', 'thyroid', 'hormone'],
  },
  {
    specialization: 'Nephrology',
    keywords: ['renal', 'kidney', 'creatinine', 'nephro', 'hypertension'],
  },
  {
    specialization: 'Oncology',
    keywords: ['oncology', 'tumor', 'cancer', 'metastatic'],
  },
  {
    specialization: 'Infectious Disease',
    keywords: ['fever', 'infection', 'sepsis', 'viral', 'bacterial'],
  },
  {
    specialization: 'Gastroenterology',
    keywords: ['abdominal', 'hepatic', 'gastro', 'bowel', 'liver'],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function compareDistanceThenName(a: DoctorProfile, b: DoctorProfile): number {
  const byDistance = a.distanceKm - b.distanceKm;
  if (byDistance !== 0) return byDistance;
  return a.name.localeCompare(b.name);
}

function collectPatientSymptomText(patient: PatientProfile): string {
  const latestVisitSymptoms = patient.pastVisits[0]?.symptoms ?? [];
  const symptoms = latestVisitSymptoms.length > 0 ? latestVisitSymptoms : patient.symptoms;
  return symptoms
    .map((symptom) => [symptom.name, symptom.trigger].join(' '))
    .join(' ')
    .toLowerCase();
}

export function searchDoctorsByNameOrSpecialization(
  doctors: DoctorProfile[],
  query: string,
): DoctorProfile[] {
  const q = normalize(query);
  if (!q) {
    return [...doctors].sort(compareDistanceThenName);
  }

  return doctors
    .filter((doctor) => {
      const haystack = [
        doctor.name,
        doctor.designation,
        doctor.specialty,
        ...doctor.specializations,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => {
      const aNameMatch = normalize(a.name).includes(q) ? 2 : 0;
      const bNameMatch = normalize(b.name).includes(q) ? 2 : 0;
      const aSpecMatch =
        normalize(a.specialty).includes(q) ||
        a.specializations.some((specialization) => normalize(specialization).includes(q))
          ? 1
          : 0;
      const bSpecMatch =
        normalize(b.specialty).includes(q) ||
        b.specializations.some((specialization) => normalize(specialization).includes(q))
          ? 1
          : 0;
      const scoreDiff = bNameMatch + bSpecMatch - (aNameMatch + aSpecMatch);
      if (scoreDiff !== 0) return scoreDiff;
      return compareDistanceThenName(a, b);
    });
}

export function inferSpecializationsFromSymptoms(symptoms: SymptomEntry[]): string[] {
  const text = symptoms
    .map((symptom) => [symptom.name, symptom.trigger].join(' '))
    .join(' ')
    .toLowerCase();

  const scored = SPECIALIZATION_RULES.map((rule) => {
    const score = rule.keywords.reduce(
      (acc, keyword) => (text.includes(keyword) ? acc + 1 : acc),
      0,
    );
    return { specialization: rule.specialization, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return ['Internal Medicine'];
  return scored.map((entry) => entry.specialization);
}

export function getRelevantDoctorsForPatient(
  patient: PatientProfile,
  doctors: DoctorProfile[],
): DoctorProfile[] {
  const latestVisitSymptoms = patient.pastVisits[0]?.symptoms ?? [];
  const sourceSymptoms = latestVisitSymptoms.length > 0 ? latestVisitSymptoms : patient.symptoms;
  const inferred = inferSpecializationsFromSymptoms(sourceSymptoms);

  const ranked = doctors
    .map((doctor) => {
      const allSpecs = [doctor.specialty, ...doctor.specializations].map(normalize);
      const overlap = inferred.reduce(
        (count, specialization) =>
          allSpecs.includes(normalize(specialization)) ? count + 1 : count,
        0,
      );
      return { doctor, overlap };
    })
    .sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return compareDistanceThenName(a.doctor, b.doctor);
    });

  const hasOverlap = ranked.some((entry) => entry.overlap > 0);
  if (!hasOverlap) return [...doctors].sort(compareDistanceThenName);
  return ranked.filter((entry) => entry.overlap > 0).map((entry) => entry.doctor);
}

export function isDoctorRelevantForPatient(
  doctor: DoctorProfile,
  patient: PatientProfile,
): boolean {
  const symptoms = patient.pastVisits[0]?.symptoms ?? patient.symptoms;
  const inferred = inferSpecializationsFromSymptoms(symptoms).map(normalize);
  const doctorSpecs = [doctor.specialty, ...doctor.specializations].map(normalize);
  return inferred.some((specialization) => doctorSpecs.includes(specialization));
}

export function getPatientsRankedForDoctor(
  doctor: DoctorProfile,
  patients: PatientProfile[],
): Array<{ patient: PatientProfile; relevant: boolean; score: number }> {
  const doctorSpecs = [doctor.specialty, ...doctor.specializations].map(normalize);

  return patients
    .map((patient) => {
      const inferred = inferSpecializationsFromSymptoms(
        patient.pastVisits[0]?.symptoms ?? patient.symptoms,
      ).map(normalize);
      const symptomText = collectPatientSymptomText(patient);
      const scoreFromSpec = inferred.reduce(
        (acc, specialization) => (doctorSpecs.includes(specialization) ? acc + 2 : acc),
        0,
      );
      const scoreFromKeyword = doctorSpecs.reduce(
        (acc, specialization) => (symptomText.includes(specialization) ? acc + 1 : acc),
        0,
      );
      const score = scoreFromSpec + scoreFromKeyword;
      return {
        patient,
        relevant: score > 0,
        score,
      };
    })
    .sort((a, b) => {
      if (a.relevant !== b.relevant) return a.relevant ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.patient.name.localeCompare(b.patient.name);
    });
}

export function formatDistance(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km away`;
}
