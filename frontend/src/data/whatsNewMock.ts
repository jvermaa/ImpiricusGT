export type InsightCategory = 'FDA Approval' | 'Guideline Update' | 'Market Launch';

export type PerformancePoint = {
  label: string;
  treatmentValue: number;
  comparatorValue: number;
  unit: '%' | 'kg' | 'hours/day' | 'points' | 'months';
  betterWhen: 'higher' | 'lower';
};

export type EvidenceSnippet = {
  source: string;
  result: string;
};

export type ExternalSource = {
  label: string;
  url: string;
};

export type WhatsNewInsight = {
  id: string;
  name: string;
  category: InsightCategory;
  therapeuticArea: string;
  updateDate: string;
  headline: string;
  hook: string;
  summary: string;
  benefits: string[];
  sideEffects: string[];
  evidence: EvidenceSnippet[];
  treatmentLabel: string;
  comparatorLabel: string;
  performanceGraphTitle: string;
  performancePoints: PerformancePoint[];
  externalSources: ExternalSource[];
  relevanceTags: string[];
  relevantPatientHint: string;
  ctaLabel: string;
  plainLanguage: string;
};

export const WHATS_NEW_INSIGHTS: WhatsNewInsight[] = [
  {
    id: 'wn-1',
    name: 'Cardiomil XR',
    category: 'FDA Approval',
    therapeuticArea: 'Cardiology',
    updateDate: 'Sep 18, 2026',
    headline: 'Entresto showed stronger heart-failure outcomes vs enalapril.',
    hook: 'Lower rates of cardiovascular death and hospitalization in PARADIGM-HF.',
    summary:
      'Sacubitril/valsartan (Entresto) demonstrated better long-term outcomes than enalapril in patients with HFrEF in a large randomized trial.',
    benefits: [
      'Lower combined risk of CV death or HF hospitalization.',
      'Lower cardiovascular mortality trend.',
      'Lower all-cause mortality trend in the trial population.',
    ],
    sideEffects: [
      'Low blood pressure',
      'Dizziness',
      'Mild rise in potassium',
      'Temporary kidney lab changes',
    ],
    evidence: [
      {
        source: 'PARADIGM-HF (n=8,442)',
        result:
          'Primary endpoint (CV death or HF hospitalization) occurred less often with Entresto than enalapril.',
      },
      {
        source: 'NEJM publication',
        result: 'Benefits were consistent across key prespecified patient subgroups.',
      },
      {
        source: 'Regulatory labeling',
        result: 'Safety profile highlights BP, renal, and potassium monitoring needs.',
      },
    ],
    treatmentLabel: 'Entresto',
    comparatorLabel: 'Enalapril',
    performanceGraphTitle: 'PARADIGM-HF Outcomes',
    performancePoints: [
      {
        label: 'CV death or HF hospitalization',
        treatmentValue: 21.8,
        comparatorValue: 26.5,
        unit: '%',
        betterWhen: 'lower',
      },
      {
        label: 'Cardiovascular death',
        treatmentValue: 13.3,
        comparatorValue: 16.5,
        unit: '%',
        betterWhen: 'lower',
      },
      {
        label: 'All-cause mortality',
        treatmentValue: 17.0,
        comparatorValue: 19.8,
        unit: '%',
        betterWhen: 'lower',
      },
    ],
    externalSources: [
      {
        label: 'NEJM: PARADIGM-HF trial',
        url: 'https://www.nejm.org/doi/full/10.1056/NEJMoa1409077',
      },
      {
        label: 'FDA label (sacubitril/valsartan)',
        url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2021/207620s018lbl.pdf',
      },
      {
        label: 'Mayo Clinic drug overview',
        url: 'https://www.mayoclinic.org/drugs-supplements/sacubitril-and-valsartan-oral-route/description/drg-20152642',
      },
    ],
    relevanceTags: ['heart failure', 'dyspnea', 'orthopnea', 'arrhythmia', 'cardiology'],
    relevantPatientHint: 'Stable NYHA II-III with repeat congestion or adherence drop-offs.',
    ctaLabel: 'Find Heart Failure Patients',
    plainLanguage:
      'For heart-failure patients, this evidence says Entresto outperformed enalapril on major outcomes.',
  },
  {
    id: 'wn-2',
    name: 'Mounjaro (tirzepatide)',
    category: 'Market Launch',
    therapeuticArea: 'Endocrinology',
    updateDate: 'Sep 22, 2026',
    headline: 'Tirzepatide showed stronger A1C and weight results vs semaglutide.',
    hook: 'Head-to-head SURPASS-2 trial showed better glycemic and weight outcomes.',
    summary:
      'In adults with Type 2 diabetes, tirzepatide delivered greater A1C reduction and weight loss compared with semaglutide 1 mg in a comparative trial.',
    benefits: [
      'Stronger average A1C reduction from baseline.',
      'Greater average weight loss.',
      'High rates of target A1C achievement.',
    ],
    sideEffects: [
      'Nausea',
      'Early satiety',
      'Mild diarrhea',
      'Temporary appetite suppression',
    ],
    evidence: [
      {
        source: 'SURPASS-2 (n=1,879)',
        result:
          'Tirzepatide produced larger reductions in both A1C and body weight than semaglutide 1 mg.',
      },
      {
        source: 'NEJM publication',
        result: 'The strongest dose tier showed the largest separation from comparator.',
      },
      {
        source: 'Regulatory labeling',
        result: 'GI side effects are common early and should be counseled before initiation.',
      },
    ],
    treatmentLabel: 'Tirzepatide 15 mg',
    comparatorLabel: 'Semaglutide 1 mg',
    performanceGraphTitle: 'SURPASS-2 Head-to-Head Results',
    performancePoints: [
      {
        label: 'A1C reduction from baseline',
        treatmentValue: 2.30,
        comparatorValue: 1.86,
        unit: '%',
        betterWhen: 'higher',
      },
      {
        label: 'Body-weight reduction',
        treatmentValue: 11.2,
        comparatorValue: 5.7,
        unit: 'kg',
        betterWhen: 'higher',
      },
      {
        label: 'Patients reaching A1C < 7%',
        treatmentValue: 92,
        comparatorValue: 86,
        unit: '%',
        betterWhen: 'higher',
      },
    ],
    externalSources: [
      {
        label: 'NEJM: SURPASS-2 trial',
        url: 'https://www.nejm.org/doi/full/10.1056/NEJMoa2107519',
      },
      {
        label: 'FDA label (tirzepatide)',
        url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2022/215866s000lbl.pdf',
      },
      {
        label: 'Mayo Clinic drug overview',
        url: 'https://www.mayoclinic.org/drugs-supplements/tirzepatide-subcutaneous-route/description/drg-20534045',
      },
    ],
    relevanceTags: ['diabetes', 'hypertension', 'headache', 'metabolic', 'endocrinology'],
    relevantPatientHint: 'Adults with uncontrolled T2D plus hypertension or weight concerns.',
    ctaLabel: 'Find Diabetes Candidates',
    plainLanguage:
      'For Type 2 diabetes patients needing stronger control, this trial showed larger sugar and weight improvements than semaglutide 1 mg.',
  },
  {
    id: 'wn-3',
    name: 'Neupro Patch (rotigotine)',
    category: 'FDA Approval',
    therapeuticArea: 'Neurology',
    updateDate: 'Sep 12, 2026',
    headline: 'Rotigotine patch showed better motor-fluctuation control vs placebo.',
    hook: 'Improved OFF-time control with transdermal dopamine-agonist delivery.',
    summary:
      'Rotigotine transdermal therapy provides continuous dopaminergic stimulation and has shown improved motor outcomes in patients with Parkinson disease.',
    benefits: [
      'Greater reduction in daily OFF time.',
      'Better combined activities-of-daily-living and motor score movement.',
      'Useful option when adherence to frequent oral schedules is difficult.',
    ],
    sideEffects: ['Skin irritation', 'Somnolence', 'Nausea', 'Orthostatic symptoms'],
    evidence: [
      {
        source: 'PREFER / advanced-PD trials',
        result: 'Rotigotine groups showed stronger OFF-time improvement than placebo groups.',
      },
      {
        source: 'Movement-disorder publications',
        result: 'Improvements were seen in both symptom control and daily function scales.',
      },
      {
        source: 'Regulatory labeling',
        result: 'Patch-site reactions and dopaminergic side effects require monitoring.',
      },
    ],
    treatmentLabel: 'Rotigotine patch',
    comparatorLabel: 'Placebo patch',
    performanceGraphTitle: 'Motor-Fluctuation Evidence Snapshot',
    performancePoints: [
      {
        label: 'OFF-time reduction',
        treatmentValue: 2.7,
        comparatorValue: 0.9,
        unit: 'hours/day',
        betterWhen: 'higher',
      },
      {
        label: 'UPDRS II+III improvement',
        treatmentValue: 8.3,
        comparatorValue: 4.1,
        unit: 'points',
        betterWhen: 'higher',
      },
      {
        label: 'Responders (>=30% OFF-time reduction)',
        treatmentValue: 56,
        comparatorValue: 34,
        unit: '%',
        betterWhen: 'higher',
      },
    ],
    externalSources: [
      {
        label: 'PubMed: rotigotine advanced-PD trial',
        url: 'https://pubmed.ncbi.nlm.nih.gov/17172423/',
      },
      {
        label: 'FDA label (rotigotine patch)',
        url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2012/021829s010lbl.pdf',
      },
      {
        label: 'Mayo Clinic drug overview',
        url: 'https://www.mayoclinic.org/drugs-supplements/rotigotine-transdermal-route/description/drg-20071097',
      },
    ],
    relevanceTags: ['parkinson', 'tremor', 'bradykinesia', 'rigidity', 'neurology'],
    relevantPatientHint: 'Patients with end-of-dose wearing off and unstable mornings.',
    ctaLabel: 'Review Parkinson Candidates',
    plainLanguage:
      'This is most useful for Parkinson’s patients whose symptoms return before the next oral dose or during the night.',
  },
  {
    id: 'wn-4',
    name: 'ADA 2026 Glycemic Guideline',
    category: 'Guideline Update',
    therapeuticArea: 'Diabetes Care Pathways',
    updateDate: 'Sep 20, 2026',
    headline: 'Guideline update: choose diabetes treatment by risk profile first.',
    hook: 'Cardio-renal and weight risk now drives earlier treatment choices.',
    summary:
      'The updated ADA pathway recommends earlier treatment intensification based on cardiovascular, renal, and weight risk, not A1C alone.',
    benefits: [
      'More personalized first-line decisions for higher-risk patients.',
      'Earlier escalation can reduce therapeutic delay.',
      'Clearer thresholds for follow-up and treatment adjustment.',
    ],
    sideEffects: [
      'No direct adverse profile (guideline update)',
      'Requires workflow updates for risk stratification',
    ],
    evidence: [
      {
        source: 'ADA Standards of Care',
        result: 'Risk-first treatment sequencing endorsed for broad outpatient care.',
      },
      {
        source: 'Meta-Review of 11 Trials',
        result: 'Early combination therapy improved target attainment at 6 months.',
      },
      {
        source: 'Health-System Implementation Reports',
        result: 'Lower delay to optimization when pathways include risk-tier prompts.',
      },
    ],
    treatmentLabel: 'Risk-first pathway',
    comparatorLabel: 'A1C-first pathway',
    performanceGraphTitle: 'Implementation Cohort Outcomes',
    performancePoints: [
      {
        label: 'Patients at A1C target by 6 months',
        treatmentValue: 63,
        comparatorValue: 49,
        unit: '%',
        betterWhen: 'higher',
      },
      {
        label: 'Time to treatment intensification',
        treatmentValue: 4.2,
        comparatorValue: 7.1,
        unit: 'months',
        betterWhen: 'lower',
      },
      {
        label: 'Therapy persistence at 12 months',
        treatmentValue: 78,
        comparatorValue: 64,
        unit: '%',
        betterWhen: 'higher',
      },
    ],
    externalSources: [
      {
        label: 'ADA Standards of Care (current supplement)',
        url: 'https://diabetesjournals.org/care/issue/48/Supplement_1',
      },
      {
        label: 'ADA/EASD consensus report',
        url: 'https://diabetesjournals.org/care/article/45/11/2753/147759',
      },
      {
        label: 'Review on therapeutic inertia in T2D',
        url: 'https://pubmed.ncbi.nlm.nih.gov/35917439/',
      },
    ],
    relevanceTags: ['diabetes', 'hypertension', 'metabolic', 'cardio-renal'],
    relevantPatientHint: 'Patients with mixed glycemic and cardiovascular risk factors.',
    ctaLabel: 'Show Guideline-Impact Patients',
    plainLanguage:
      'If a diabetes patient has heart or kidney risk, this guideline supports acting sooner and not waiting on A1C alone.',
  },
];
