export type SymptomOnset = 'Gradual' | 'Sudden';

export type SymptomEntry = {
  id: string;
  name: string;
  duration: string;
  frequency: string;
  trigger: string;
  onset: SymptomOnset;
};

export type PastVisit = {
  id: string;
  date: string;
  diagnosis: string;
  summary: string;
  symptoms: SymptomEntry[];
  currentMedications: string;
  alcoholUse: 'None' | 'Social' | 'Daily' | 'Not recorded';
  smokingStatus: 'Never smoker' | 'Former smoker' | 'Current smoker';
  immuneStatus: 'Immunocompromised' | 'Immunocompetent' | 'Not recorded';
  pregnancyStatus: 'Pregnant' | 'Not Pregnant' | 'N/A';
  familyMedicalHistory: string;
  labResults: string;
};

export type PatientProfile = {
  id: string;
  name: string;
  age: number;
  sex: 'Male' | 'Female';
  ageGroup: string;
  diagnosis: string;
  prescription: string;
  relevantMedicalHistory: string;
  familyMedicalHistory: string;
  currentMedications: string;
  alcoholUse: 'None' | 'Social' | 'Daily' | 'Not recorded';
  smokingStatus: 'Never smoker' | 'Former smoker' | 'Current smoker';
  immuneStatus: 'Immunocompromised' | 'Immunocompetent' | 'Not recorded';
  pregnancyStatus: 'Pregnant' | 'Not Pregnant' | 'N/A';
  labResults: string;
  symptoms: SymptomEntry[];
  pastVisits: PastVisit[];
};

/** Hardcoded high-relevance matches for suitable-patient / cohort analyzer mode. */
export const HIGH_MATCH_PATIENT_IDS = ['P031'] as const;

export const PATIENTS: PatientProfile[] = [
  {
    id: 'pat-1',
    name: 'Arthur Pendelton',
    age: 51,
    sex: 'Male',
    ageGroup: '45-54',
    diagnosis: 'Chronic Heart Failure',
    prescription: 'Lisinopril 10mg',
    relevantMedicalHistory:
      'History of fluid overload admission in 2024. Stable with consistent cardiology follow-up.',
    familyMedicalHistory:
      'Father with CHF, maternal stroke at 62, sibling with hypertension.',
    currentMedications:
      'Lisinopril 10mg PO daily; Carvedilol 6.25mg PO BID; Furosemide 20mg PRN.',
    alcoholUse: 'Social',
    smokingStatus: 'Former smoker',
    immuneStatus: 'Immunocompetent',
    pregnancyStatus: 'N/A',
    labResults:
      'BNP elevated; stable creatinine; mild eosinophilia; CXR with mild pulmonary congestion.',
    symptoms: [
      {
        id: 's-arthur-1',
        name: 'Dyspnea',
        duration: '8 weeks',
        frequency: 'Daily',
        trigger: 'Exertion',
        onset: 'Gradual',
      },
      {
        id: 's-arthur-2',
        name: 'Fatigue',
        duration: '6 weeks',
        frequency: 'Daily',
        trigger: 'Afternoon',
        onset: 'Gradual',
      },
      {
        id: 's-arthur-3',
        name: 'Arrhythmia',
        duration: '4 weeks',
        frequency: 'Intermittent',
        trigger: 'Exertion',
        onset: 'Sudden',
      },
    ],
    pastVisits: [
      {
        id: 'v-arthur-1',
        date: 'Sep 08, 2026',
        diagnosis: 'Moderate CHF, NYHA II',
        summary:
          'Adjusted carvedilol dosage; advised daily weight check and 2-week follow-up.',
        symptoms: [
          {
            id: 'v-arthur-1-s1',
            name: 'Dyspnea',
            duration: '8 weeks',
            frequency: 'Daily',
            trigger: 'Exertion',
            onset: 'Gradual',
          },
          {
            id: 'v-arthur-1-s2',
            name: 'Orthopnea',
            duration: '4 weeks',
            frequency: 'Nightly',
            trigger: 'Lying down',
            onset: 'Gradual',
          },
        ],
        currentMedications:
          'Lisinopril 10mg PO daily; Carvedilol 6.25mg PO BID; Furosemide 20mg PRN.',
        alcoholUse: 'Social',
        smokingStatus: 'Former smoker',
        immuneStatus: 'Immunocompetent',
        pregnancyStatus: 'N/A',
        familyMedicalHistory:
          'Father with CHF, maternal stroke at 62, sibling with hypertension.',
        labResults:
          'BNP elevated; stable creatinine; mild eosinophilia; CXR with mild pulmonary congestion.',
      },
      {
        id: 'v-arthur-2',
        date: 'Aug 02, 2026',
        diagnosis: 'Mild fluid retention',
        summary: 'Added PRN diuretic and reinforced low-sodium diet adherence.',
        symptoms: [
          {
            id: 'v-arthur-2-s1',
            name: 'Fatigue',
            duration: '5 weeks',
            frequency: 'Daily',
            trigger: 'Afternoon',
            onset: 'Gradual',
          },
        ],
        currentMedications: 'Lisinopril 10mg PO daily; Furosemide 20mg PRN.',
        alcoholUse: 'Social',
        smokingStatus: 'Former smoker',
        immuneStatus: 'Immunocompetent',
        pregnancyStatus: 'N/A',
        familyMedicalHistory:
          'Father with CHF, maternal stroke at 62, sibling with hypertension.',
        labResults: 'Mild BNP elevation; edema improved with diuretic use.',
      },
    ],
  },
  {
    id: 'pat-2',
    name: 'Sonia Kowalski',
    age: 68,
    sex: 'Female',
    ageGroup: '65-74',
    diagnosis: "Parkinson's Disease",
    prescription: 'Levodopa 100mg',
    relevantMedicalHistory:
      'Progressive rigidity with intermittent gait freezing. Good response to therapy windows.',
    familyMedicalHistory: 'No known family history of Parkinsonism or tremor disorders.',
    currentMedications: 'Levodopa 100mg TID; Rasagiline 1mg daily.',
    alcoholUse: 'None',
    smokingStatus: 'Never smoker',
    immuneStatus: 'Immunocompetent',
    pregnancyStatus: 'N/A',
    labResults: 'Routine metabolic panel within range; MRI without acute lesions.',
    symptoms: [
      {
        id: 's-sonia-1',
        name: 'Tremor',
        duration: '2 years',
        frequency: 'Intermittent',
        trigger: 'Stress',
        onset: 'Gradual',
      },
      {
        id: 's-sonia-2',
        name: 'Stiffness',
        duration: '18 months',
        frequency: 'Daily',
        trigger: 'Morning',
        onset: 'Gradual',
      },
      {
        id: 's-sonia-3',
        name: 'Bradykinesia',
        duration: '14 months',
        frequency: 'Daily',
        trigger: 'End of dose',
        onset: 'Gradual',
      },
    ],
    pastVisits: [
      {
        id: 'v-sonia-1',
        date: 'Sep 10, 2026',
        diagnosis: 'Motor fluctuation',
        summary: 'Adjusted dose timing and recommended PT mobility program.',
        symptoms: [
          {
            id: 'v-sonia-1-s1',
            name: 'Tremor',
            duration: '2 years',
            frequency: 'Intermittent',
            trigger: 'Stress',
            onset: 'Gradual',
          },
          {
            id: 'v-sonia-1-s2',
            name: 'Bradykinesia',
            duration: '14 months',
            frequency: 'Daily',
            trigger: 'End of dose',
            onset: 'Gradual',
          },
        ],
        currentMedications: 'Levodopa 100mg TID; Rasagiline 1mg daily.',
        alcoholUse: 'None',
        smokingStatus: 'Never smoker',
        immuneStatus: 'Immunocompetent',
        pregnancyStatus: 'N/A',
        familyMedicalHistory: 'No known family history of Parkinsonism or tremor disorders.',
        labResults: 'Routine metabolic panel within range; MRI without acute lesions.',
      },
    ],
  },
  {
    id: 'pat-3',
    name: 'James Carter',
    age: 49,
    sex: 'Male',
    ageGroup: '45-54',
    diagnosis: 'Essential Hypertension',
    prescription: 'Amlodipine 5mg',
    relevantMedicalHistory:
      'Persistent BP elevations despite lifestyle interventions. Intermittent vertigo episodes.',
    familyMedicalHistory:
      'Mother with uncontrolled HTN; paternal history of ischemic heart disease.',
    currentMedications: 'Amlodipine 5mg daily; Hydrochlorothiazide 12.5mg daily.',
    alcoholUse: 'Social',
    smokingStatus: 'Current smoker',
    immuneStatus: 'Immunocompetent',
    pregnancyStatus: 'N/A',
    labResults: 'Mild LDL elevation; renal profile stable.',
    symptoms: [
      {
        id: 's-james-1',
        name: 'Headache',
        duration: '5 weeks',
        frequency: '3x per week',
        trigger: 'Poor sleep',
        onset: 'Gradual',
      },
      {
        id: 's-james-2',
        name: 'Vertigo',
        duration: '3 weeks',
        frequency: 'Intermittent',
        trigger: 'Sudden movement',
        onset: 'Sudden',
      },
      {
        id: 's-james-3',
        name: 'Hypertension',
        duration: '1 year',
        frequency: 'Persistent',
        trigger: 'Salt intake',
        onset: 'Gradual',
      },
    ],
    pastVisits: [
      {
        id: 'v-james-1',
        date: 'Aug 28, 2026',
        diagnosis: 'Uncontrolled Stage 1 HTN',
        summary: 'Started amlodipine and advised home BP log.',
        symptoms: [
          {
            id: 'v-james-1-s1',
            name: 'Headache',
            duration: '5 weeks',
            frequency: '3x per week',
            trigger: 'Poor sleep',
            onset: 'Gradual',
          },
          {
            id: 'v-james-1-s2',
            name: 'Vertigo',
            duration: '3 weeks',
            frequency: 'Intermittent',
            trigger: 'Sudden movement',
            onset: 'Sudden',
          },
        ],
        currentMedications: 'Amlodipine 5mg daily; Hydrochlorothiazide 12.5mg daily.',
        alcoholUse: 'Social',
        smokingStatus: 'Current smoker',
        immuneStatus: 'Immunocompetent',
        pregnancyStatus: 'N/A',
        familyMedicalHistory:
          'Mother with uncontrolled HTN; paternal history of ischemic heart disease.',
        labResults: 'Mild LDL elevation; renal profile stable.',
      },
    ],
  },
  {
    id: 'pat-4',
    name: 'Meera Patel',
    age: 34,
    sex: 'Female',
    ageGroup: '25-34',
    diagnosis: 'Mild Asthma',
    prescription: 'Albuterol inhaler',
    relevantMedicalHistory:
      'Seasonal symptom flares with occasional exercise-induced exacerbation.',
    familyMedicalHistory: 'Maternal history of atopy and allergic rhinitis.',
    currentMedications:
      'Albuterol inhaler PRN; Budesonide inhaler BID during high-risk seasons.',
    alcoholUse: 'None',
    smokingStatus: 'Never smoker',
    immuneStatus: 'Immunocompetent',
    pregnancyStatus: 'Not Pregnant',
    labResults: 'Mild eosinophilia; spirometry with reversible obstruction.',
    symptoms: [
      {
        id: 's-meera-1',
        name: 'Wheezing',
        duration: '6 months',
        frequency: 'Intermittent',
        trigger: 'Pollen exposure',
        onset: 'Gradual',
      },
      {
        id: 's-meera-2',
        name: 'Cough',
        duration: '4 weeks',
        frequency: 'Daily',
        trigger: 'Lying down',
        onset: 'Gradual',
      },
      {
        id: 's-meera-3',
        name: 'Chest tightness',
        duration: '4 weeks',
        frequency: 'Nightly',
        trigger: 'Cold air',
        onset: 'Gradual',
      },
    ],
    pastVisits: [
      {
        id: 'v-meera-1',
        date: 'Sep 01, 2026',
        diagnosis: 'Mild persistent asthma flare',
        summary: 'Stepped up inhaled corticosteroid for 14 days.',
        symptoms: [
          {
            id: 'v-meera-1-s1',
            name: 'Wheezing',
            duration: '6 months',
            frequency: 'Intermittent',
            trigger: 'Pollen exposure',
            onset: 'Gradual',
          },
          {
            id: 'v-meera-1-s2',
            name: 'Cough',
            duration: '4 weeks',
            frequency: 'Daily',
            trigger: 'Lying down',
            onset: 'Gradual',
          },
        ],
        currentMedications:
          'Albuterol inhaler PRN; Budesonide inhaler BID during high-risk seasons.',
        alcoholUse: 'None',
        smokingStatus: 'Never smoker',
        immuneStatus: 'Immunocompetent',
        pregnancyStatus: 'Not Pregnant',
        familyMedicalHistory: 'Maternal history of atopy and allergic rhinitis.',
        labResults: 'Mild eosinophilia; spirometry with reversible obstruction.',
      },
    ],
  },
];
