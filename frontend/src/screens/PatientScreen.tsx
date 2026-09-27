import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createPatient,
  loadCurrentDoctor,
  loadMyPatients,
  loadConsultDirectory,
  loadRankedDoctors,
  loadSimilarCases,
  loadThreadMessages,
  openConsultThread,
  prepareSummarizedRecordPdf,
  recordPdfUrl,
  savePatientVisit,
  savePatientDetails,
  sendConsultMessage,
  sendPromptEmail,
  sendSummarizedRecordPdf,
  type SimilarCohortAnalysisResponse,
  type SimilarCohortMatch,
} from '../api/clinic';
import { CURRENT_DOCTOR_KEY } from '../api/config';
import { Avatar } from '../components/Avatar';
import { DoctorProfileCard } from '../components/DoctorProfileCard';
import { ChatThread } from '../components/ChatThread';
import {
  ChevronLeftIcon,
  CloseIcon,
  FilterIcon,
  NotificationIcon,
  SearchIcon,
  PdfIcon,
  EditIcon,
  AddVisitIcon,
  ReferHcpIcon,
} from '../components/NavIcons';
import type { AppNotification } from '../data/notificationsMock';
import { DOCTOR_DIRECTORY, type DoctorProfile } from '../data/chatMock';
import type { ChatMessage, CurrentDoctor, DoctorThread } from '../types/chat';
import {
  formatDistance,
  inferSpecializationsFromSymptoms,
  searchDoctorsByNameOrSpecialization,
} from '../data/doctorDiscovery';
import {
  HIGH_MATCH_PATIENT_IDS,
  PATIENTS,
  type PastVisit,
  type PatientProfile,
  type SymptomEntry,
  type SymptomOnset,
} from '../data/patientMock';
import {
  applyStrengthFilter,
  DRUG_CATALOG,
  getStrengthOptions,
  groupDrugMatches,
  rankDrugsBySaltQuery,
  type DrugMatchBucket,
  type RankedDrugMatch,
} from '../data/drugCatalogMock';
import {
  WHATS_NEW_INSIGHTS,
  type InsightCategory,
  type PerformancePoint,
  type WhatsNewInsight,
} from '../data/whatsNewMock';
import { colors } from '../theme/colors';
import { ReferralWorkspace } from './ReferralWorkspace';

type RouteState =
  | { name: 'list' }
  | { name: 'addPatient' }
  | { name: 'whatsNew' }
  | { name: 'whatsNewDetail'; insightId: string }
  | { name: 'edit'; patientId: string }
  | { name: 'addVisit'; patientId: string; visitId?: string }
  | { name: 'visitDetails'; patientId: string; visitId: string }
  | { name: 'hcpList'; patientId: string }
  | { name: 'doctorProfile'; patientId: string; doctorId: string }
  | { name: 'doctorChat'; patientId: string; doctorId: string };

type ActionKey =
  | 'find-similar'
  | 'generate-pdf'
  | 'send-notification'
  | 'edit-patient'
  | 'add-visit'
  | 'ask-refer-hcp';

type VisitForm = {
  diagnosis: string;
  notes: string;
  symptoms: SymptomEntry[];
  currentMedications: string;
  alcoholUse: 'None' | 'Social' | 'Daily';
  smokingStatus: 'Never smoker' | 'Former smoker' | 'Current smoker';
  immuneStatus: 'Immunocompromised' | 'Immunocompetent';
  pregnancyStatus: 'Pregnant' | 'Not Pregnant' | 'N/A';
  labResults: string;
};

type PatientForm = {
  name: string;
  email: string;
  age: string;
  sex: PatientProfile['sex'];
  diagnosis: string;
  relevantMedicalHistory: string;
  familyMedicalHistory: string;
  currentMedications: string;
  alcoholUse: PatientProfile['alcoholUse'];
  smokingStatus: PatientProfile['smokingStatus'];
  immuneStatus: PatientProfile['immuneStatus'];
  pregnancyStatus: PatientProfile['pregnancyStatus'];
  labResults: string;
};

type SymptomDraft = {
  name: string;
  duration: string;
  frequency: string;
  trigger: string;
  onset: SymptomOnset;
};

type SearchMode = 'patients' | 'drugs';

type SearchOverlayState = 'idle' | 'menu';

type DrugListRow =
  | { id: string; type: 'header'; title: string; description: string }
  | { id: string; type: 'drug'; match: RankedDrugMatch };

const ACTIONS: Array<{
  key: ActionKey;
  label: string;
  Icon: (props: { color: string; size?: number }) => React.ReactElement;
}> = [
  { key: 'find-similar', label: 'Find Similar Patients', Icon: SearchIcon },
  { key: 'generate-pdf', label: 'Generate Medical Record PDF', Icon: PdfIcon },
  { key: 'edit-patient', label: 'Edit Patient Details', Icon: EditIcon },
  { key: 'add-visit', label: 'Add Visit', Icon: AddVisitIcon },
  { key: 'ask-refer-hcp', label: 'Ask/Refer an HCP', Icon: ReferHcpIcon },
];

const SEND_NOTIFICATION_ACTION: (typeof ACTIONS)[number] = {
  key: 'send-notification',
  label: 'Send Notification',
  Icon: NotificationIcon,
};

const HIGH_MATCH_SET = new Set<string>(HIGH_MATCH_PATIENT_IDS);

const EMPTY_SYMPTOM: SymptomDraft = {
  name: '',
  duration: '',
  frequency: '',
  trigger: '',
  onset: 'Gradual',
};

const FOLLOW_UP_FREQUENCY_OPTIONS = [
  '1 day',
  '2 days',
  '3 days',
  '4 days',
  '5 days',
  '6 days',
  '1 week',
  '2 weeks',
  '3 weeks',
  '4 weeks',
] as const;

const FOLLOW_UP_PROMPT_PLACEHOLDER =
  'What do you want to follow up about? "Check if their symptoms are improving, if there were any side effects...".';

const INSIGHT_FILTERS: Array<'All' | InsightCategory> = [
  'All',
  'FDA Approval',
  'Market Launch',
  'Guideline Update',
];

const INSIGHT_ACCENT_BY_CATEGORY: Record<InsightCategory, string> = {
  'FDA Approval': '#3A7AFE',
  'Market Launch': '#8B5CF6',
  'Guideline Update': '#00A8A8',
};

const WHATS_NEW_BUTTON_IMAGE = require('../../assets/new-removebg-preview.png');

const PERFORMANCE_GRAPH_HELP_TEXT =
  'Each row compares the study drug against its trial comparator using reported study values.';

const METRIC_GLOSSARY: Record<string, string> = {
  A1C: 'A1C reflects average blood sugar over about 3 months.',
  LDL: 'LDL is low-density cholesterol; lower is usually better for cardiovascular risk.',
  UPDRS:
    'UPDRS is a Parkinson scale for symptoms and function; bigger improvement in score change is better.',
};

function getRelevantPatientsForInsight(
  patients: PatientProfile[],
  insight: WhatsNewInsight,
): PatientProfile[] {
  const keywordSet = new Set(insight.relevanceTags.map((tag) => tag.toLowerCase()));
  return patients.filter((patient) => {
    const searchableText = [
      patient.diagnosis,
      patient.relevantMedicalHistory,
      patient.prescription,
      patient.symptoms.map((symptom) => symptom.name).join(' '),
      patient.pastVisits.map((visit) => `${visit.diagnosis} ${visit.summary}`).join(' '),
    ]
      .join(' ')
      .toLowerCase();

    return [...keywordSet].some((keyword) => searchableText.includes(keyword));
  });
}

function getRelevantPatientsForDrug(patients: PatientProfile[], drug: (typeof DRUG_CATALOG)[number]) {
  const normalizedTerms = Array.from(
    new Set(
      [drug.productName, ...drug.salts.map((salt) => salt.name), ...drug.salts.map((salt) => salt.purpose)]
        .flatMap((entry) => entry.split(/[\s,/+-]+/g))
        .map((token) => token.trim().toLowerCase())
        .filter((token) => token.length >= 4),
    ),
  );

  return patients
    .map((patient) => {
      const patientText = [
        patient.diagnosis,
        patient.prescription,
        patient.relevantMedicalHistory,
        patient.symptoms.map((symptom) => symptom.name).join(' '),
        patient.pastVisits
          .map((visit) =>
            [visit.diagnosis, visit.summary, visit.currentMedications]
              .filter(Boolean)
              .join(' '),
          )
          .join(' '),
      ]
        .join(' ')
        .toLowerCase();

      const score = normalizedTerms.reduce((total, term) => {
        return patientText.includes(term) ? total + 1 : total;
      }, 0);

      if (score === 0) return null;
      return { patient, score };
    })
    .filter((entry): entry is { patient: PatientProfile; score: number } => entry !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.patient.name.localeCompare(right.patient.name);
    })
    .map((entry) => entry.patient);
}

function normalizeStoredField(value: string): string {
  return value === 'Not provided' ? '' : value;
}

function normalizeAlcoholUse(value: PastVisit['alcoholUse']): VisitForm['alcoholUse'] {
  return value;
}

function normalizeImmuneStatus(value: PastVisit['immuneStatus']): VisitForm['immuneStatus'] {
  return value;
}

function anonymizePatientEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!domain) return 'hidden@example.com';
  if (!localPart || localPart.length <= 1) return `*@${domain}`;
  return `${localPart[0]}***@${domain}`;
}

function displayPatientEmail(patient: PatientProfile): string {
  return patient.anonymizedEmail ?? anonymizePatientEmail(patient.email);
}

function makeEmptySimilarAnalysis(): SimilarCohortAnalysisResponse {
  return {
    title: 'Similar Cohort Analysis',
    explanation:
      'Clinical match based on symptom overlaps, age cohort (45-54), and diagnosis matches',
    source: 'fallback',
    matches: [],
  };
}

function makeVisitForm(patient: PatientProfile, visit?: PastVisit): VisitForm {
  if (visit) {
    return {
      diagnosis: visit.diagnosis,
      notes: visit.summary,
      symptoms: visit.symptoms.map((symptom) => ({ ...symptom })),
      currentMedications: normalizeStoredField(visit.currentMedications),
      alcoholUse: normalizeAlcoholUse(visit.alcoholUse),
      smokingStatus: visit.smokingStatus,
      immuneStatus: normalizeImmuneStatus(visit.immuneStatus),
      pregnancyStatus: visit.pregnancyStatus,
      labResults: normalizeStoredField(visit.labResults),
    };
  }

  return {
    diagnosis: patient.diagnosis,
    notes: '',
    symptoms: [],
    currentMedications: '',
    alcoholUse: 'None',
    smokingStatus: 'Never smoker',
    immuneStatus: 'Immunocompetent',
    pregnancyStatus: patient.sex === 'Female' ? 'Not Pregnant' : 'N/A',
    labResults: '',
  };
}

function makePatientForm(patient?: PatientProfile): PatientForm {
  if (!patient) {
    return {
      name: '',
      email: 'harisamser27@gmail.com',
      age: '',
      sex: 'Female',
      diagnosis: '',
      relevantMedicalHistory: '',
      familyMedicalHistory: '',
      currentMedications: '',
      alcoholUse: 'None',
      smokingStatus: 'Never smoker',
      immuneStatus: 'Immunocompetent',
      pregnancyStatus: 'N/A',
      labResults: '',
    };
  }
  return {
    name: patient.name,
    email: patient.email,
    age: String(patient.age || ''),
    sex: patient.sex,
    diagnosis: patient.diagnosis,
    relevantMedicalHistory: patient.relevantMedicalHistory,
    familyMedicalHistory: patient.familyMedicalHistory,
    currentMedications: patient.currentMedications,
    alcoholUse: patient.alcoholUse,
    smokingStatus: patient.smokingStatus,
    immuneStatus: patient.immuneStatus,
    pregnancyStatus: patient.pregnancyStatus,
    labResults: patient.labResults,
  };
}

export function PatientScreen({
  suitableMode = false,
  suitableSource = null,
  onExitSuitableMode,
  onOpenDirectory,
  onOpenReferrals,
}: {
  suitableMode?: boolean;
  suitableSource?: AppNotification | null;
  onExitSuitableMode?: () => void;
  onOpenDirectory?: (filter: import('../api/directory').DirectoryFilter) => void;
  onOpenReferrals?: (direction: 'in' | 'out', withDoctor?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [route, setRoute] = useState<RouteState>({ name: 'list' });
  const [query, setQuery] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [consultThreads, setConsultThreads] = useState<DoctorThread[]>([]);
  const [confirmReferralOpen, setConfirmReferralOpen] = useState(false);
  const [referralSuccessMessage, setReferralSuccessMessage] = useState<string | null>(null);
  const [hcpSearchQuery, setHcpSearchQuery] = useState('');
  const [rankedHcps, setRankedHcps] = useState<DoctorProfile[] | null>(null);
  const [similarAnalysis, setSimilarAnalysis] = useState<SimilarCohortAnalysisResponse | null>(null);
  const [selectedSimilarMatchId, setSelectedSimilarMatchId] = useState<string | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [emailPrompt, setEmailPrompt] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfPreparing, setPdfPreparing] = useState(false);
  const [pdfReady, setPdfReady] = useState(false);
  const [pdfSendBusy, setPdfSendBusy] = useState(false);
  const [pdfSummarySource, setPdfSummarySource] = useState<'gemini' | 'fallback' | null>(null);
  const [apiDoctors, setApiDoctors] = useState<DoctorProfile[]>([]);
  const [currentDoctor, setCurrentDoctor] = useState<CurrentDoctor | null>(null);
  const [formalReferralPatient, setFormalReferralPatient] = useState<PatientProfile | null>(null);

  const [visitForm, setVisitForm] = useState<VisitForm | null>(null);
  const [patientForm, setPatientForm] = useState<PatientForm | null>(null);
  const [addSymptomOpen, setAddSymptomOpen] = useState(false);
  const [symptomDraft, setSymptomDraft] = useState<SymptomDraft>(EMPTY_SYMPTOM);
  const [followUpPromptOpen, setFollowUpPromptOpen] = useState(false);
  const [followUpFrequencyIndex, setFollowUpFrequencyIndex] = useState(0);
  const [followUpTopic, setFollowUpTopic] = useState('');
  const [visitSaveBusy, setVisitSaveBusy] = useState(false);
  const [insightFilter, setInsightFilter] = useState<'All' | InsightCategory>('All');
  const [insightFocusPatientIds, setInsightFocusPatientIds] = useState<string[]>([]);
  const [insightFocusLabel, setInsightFocusLabel] = useState<string | null>(null);
  const [patientFocusSource, setPatientFocusSource] = useState<'insight' | 'drug' | null>(null);
  const [drugFocusReturnState, setDrugFocusReturnState] = useState<{
    draftQuery: string;
    submittedQuery: string;
  } | null>(null);
  const [searchMode, setSearchMode] = useState<SearchMode>('patients');
  const [searchOverlayState, setSearchOverlayState] = useState<SearchOverlayState>('idle');
  const [searchInlineActive, setSearchInlineActive] = useState(false);
  const [searchLayerVisible, setSearchLayerVisible] = useState(false);
  const [drugSaltQuery, setDrugSaltQuery] = useState('');
  const [drugSubmittedSaltQuery, setDrugSubmittedSaltQuery] = useState('');
  const [drugSearchLoading, setDrugSearchLoading] = useState(false);
  const [strengthFilterOpen, setStrengthFilterOpen] = useState(false);
  const [selectedStrengths, setSelectedStrengths] = useState<string[]>([]);
  const [strengthFilterText, setStrengthFilterText] = useState('');
  const [selectedDrugId, setSelectedDrugId] = useState<string | null>(null);
  const drugSearchDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const menuBackdropProgress = useSharedValue(0);
  const menuDrugsPillProgress = useSharedValue(0);
  const menuPatientsPillProgress = useSharedValue(0);

  const clearDrugSearchDelay = useCallback(() => {
    if (!drugSearchDelayRef.current) return;
    clearTimeout(drugSearchDelayRef.current);
    drugSearchDelayRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearDrugSearchDelay();
    };
  }, [clearDrugSearchDelay]);

  useEffect(() => {
    let cancelled = false;
    loadConsultDirectory()
      .then((consults) => {
        if (cancelled) return;
        setApiDoctors(consults.directory);
        setConsultThreads(consults.threads);
      })
      .catch(() => {
        if (!cancelled) setApiDoctors([]);
      });
    loadCurrentDoctor()
      .then((doctor) => {
        if (!cancelled) setCurrentDoctor(doctor);
      })
      .catch(() => {
        /* Ask/Refer formal path stays gated on currentDoctor. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadMyPatients()
      .then((rows) => {
        if (cancelled) return;
        setPatients(rows);
        if (rows.length === 0) {
          setInfoMessage('No patients found for this doctor in the backend.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPatients([]);
          setInfoMessage('Could not load patients from backend. Check API connection.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!suitableMode) return;
    clearDrugSearchDelay();
    setRoute({ name: 'list' });
    setSelectedPatientId(null);
    setInfoMessage(null);
    setQuery('');
    setDrugSaltQuery('');
    setDrugSubmittedSaltQuery('');
    setDrugSearchLoading(false);
    setSearchLayerVisible(false);
    setSearchOverlayState('idle');
    setSearchInlineActive(false);
    setSelectedDrugId(null);
    setStrengthFilterOpen(false);
    setPatientFocusSource(null);
    setDrugFocusReturnState(null);
    setInsightFocusPatientIds([]);
    setInsightFocusLabel(null);
    setSimilarAnalysis(null);
    setSelectedSimilarMatchId(null);
    // Hardcoded cohort panel for finder mode
    setPatients(PATIENTS);
    menuBackdropProgress.value = 0;
    menuDrugsPillProgress.value = 0;
    menuPatientsPillProgress.value = 0;
  }, [clearDrugSearchDelay, suitableMode]);

  const exitSuitableMode = () => {
    onExitSuitableMode?.();
    loadMyPatients()
      .then((rows) => {
        setPatients(rows);
        if (rows.length === 0) {
          setInfoMessage('No patients found for this doctor in the backend.');
        }
      })
      .catch(() => {
        setPatients([]);
        setInfoMessage('Could not load patients from backend. Check API connection.');
      });
  };

  const routedPatientId =
    route.name === 'edit' ||
    route.name === 'addVisit' ||
    route.name === 'visitDetails' ||
    route.name === 'hcpList' ||
    route.name === 'doctorProfile' ||
    route.name === 'doctorChat'
      ? route.patientId
      : null;

  const routedPatient = useMemo(
    () =>
      routedPatientId
        ? patients.find((patient) => patient.id === routedPatientId) ?? null
        : null,
    [patients, routedPatientId],
  );

  const hcpCatalog = apiDoctors.length > 0 ? apiDoctors : DOCTOR_DIRECTORY;
  const routedDoctorId =
    route.name === 'doctorProfile' || route.name === 'doctorChat' ? route.doctorId : null;
  const routedDoctor = useMemo(
    () =>
      routedDoctorId
        ? hcpCatalog.find((doctor) => doctor.id === routedDoctorId) ?? null
        : null,
    [hcpCatalog, routedDoctorId],
  );

  const routedDoctorThread = useMemo(
    () =>
      routedDoctorId
        ? consultThreads.find((thread) => thread.id === routedDoctorId) ?? null
        : null,
    [consultThreads, routedDoctorId],
  );

  const selectedInsight = useMemo(
    () =>
      route.name === 'whatsNewDetail'
        ? WHATS_NEW_INSIGHTS.find((insight) => insight.id === route.insightId) ?? null
        : null,
    [route],
  );
  const selectedInsightGlossary = useMemo(() => {
    if (!selectedInsight) return [];

    const labelsText = selectedInsight.performancePoints.map((point) => point.label).join(' ');
    return Object.entries(METRIC_GLOSSARY)
      .filter(([key]) => labelsText.includes(key))
      .map(([key, value]) => ({ key, value }));
  }, [selectedInsight]);
  const filteredInsights = useMemo(
    () =>
      insightFilter === 'All'
        ? WHATS_NEW_INSIGHTS
        : WHATS_NEW_INSIGHTS.filter((insight) => insight.category === insightFilter),
    [insightFilter],
  );

  const inferredSpecializations = useMemo(() => {
    if (!routedPatient) return [];
    const sourceSymptoms = routedPatient.pastVisits[0]?.symptoms ?? routedPatient.symptoms;
    return inferSpecializationsFromSymptoms(sourceSymptoms);
  }, [routedPatient]);
  const defaultSpecializationQuery = inferredSpecializations[0] ?? '';
  const hcpSearchResults = useMemo(() => {
    const pool = rankedHcps && rankedHcps.length > 0 ? rankedHcps : hcpCatalog;
    const typed = hcpSearchQuery.trim();
    if (!typed && rankedHcps && rankedHcps.length > 0) return rankedHcps.slice(0, 10);
    const seedQuery = typed || defaultSpecializationQuery;
    return searchDoctorsByNameOrSpecialization(pool, seedQuery).slice(0, 10);
  }, [hcpCatalog, hcpSearchQuery, defaultSpecializationQuery, rankedHcps]);

  const activeVisit = useMemo(() => {
    if (route.name !== 'visitDetails' || !routedPatient) return null;
    return routedPatient.pastVisits.find((visit) => visit.id === route.visitId) ?? null;
  }, [route, routedPatient]);

  useEffect(() => {
    if (route.name === 'edit' && routedPatient && !patientForm) {
      setPatientForm(makePatientForm(routedPatient));
    }
    if (route.name === 'addPatient' && !patientForm) {
      setPatientForm(makePatientForm());
    }
  }, [route, routedPatient, patientForm]);

  const selectedPatient = useMemo(
    () =>
      selectedPatientId
        ? patients.find((patient) => patient.id === selectedPatientId) ?? null
        : null,
    [patients, selectedPatientId],
  );

  useEffect(() => {
    if (selectedPatient) return;
    setEmailOpen(false);
    setEmailBusy(false);
    setPdfOpen(false);
    setPdfPreparing(false);
    setPdfReady(false);
    setPdfSendBusy(false);
    setPdfSummarySource(null);
  }, [selectedPatient]);

  const selectedSimilarMatch = useMemo(
    () =>
      selectedSimilarMatchId && similarAnalysis
        ? similarAnalysis.matches.find((match) => match.match_id === selectedSimilarMatchId) ?? null
        : null,
    [selectedSimilarMatchId, similarAnalysis],
  );

  const sortedPatients = useMemo(() => {
    if (suitableMode) {
      return [...patients].sort((a, b) => {
        const aMatch = HIGH_MATCH_SET.has(a.id) ? 0 : 1;
        const bMatch = HIGH_MATCH_SET.has(b.id) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        return a.name.localeCompare(b.name);
      });
    }

    if (insightFocusPatientIds.length === 0) {
      return [...patients].sort((a, b) => a.name.localeCompare(b.name));
    }

    const focusSet = new Set(insightFocusPatientIds);
    return [...patients].sort((a, b) => {
      const aFocus = focusSet.has(a.id) ? 0 : 1;
      const bFocus = focusSet.has(b.id) ? 0 : 1;
      if (aFocus !== bFocus) return aFocus - bFocus;
      return a.name.localeCompare(b.name);
    });
  }, [patients, suitableMode, insightFocusPatientIds]);

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sortedPatients;

    return sortedPatients.filter((patient) => {
      const symptomText = patient.symptoms.map((symptom) => symptom.name).join(' ');
      return (
        patient.name.toLowerCase().includes(normalized) ||
        patient.diagnosis.toLowerCase().includes(normalized) ||
        symptomText.toLowerCase().includes(normalized)
      );
    });
  }, [query, sortedPatients]);

  const highMatchPatients = useMemo(
    () => patients.filter((patient) => HIGH_MATCH_SET.has(patient.id)),
    [patients],
  );

  const rankedDrugMatches = useMemo(
    () => rankDrugsBySaltQuery(drugSubmittedSaltQuery),
    [drugSubmittedSaltQuery],
  );
  const strengthOptions = useMemo(() => getStrengthOptions(DRUG_CATALOG), []);
  const filteredDrugMatches = useMemo(
    () =>
      applyStrengthFilter(rankedDrugMatches, {
        selectedStrengths,
        text: strengthFilterText,
      }),
    [rankedDrugMatches, selectedStrengths, strengthFilterText],
  );
  const groupedDrugMatches = useMemo(
    () => groupDrugMatches(filteredDrugMatches),
    [filteredDrugMatches],
  );

  /** Send Notification only after Notification -> Find Suitable Patients. */
  const sheetActions = useMemo(
    () => (suitableMode ? [SEND_NOTIFICATION_ACTION, ...ACTIONS] : ACTIONS),
    [suitableMode],
  );

  const drugResultRows = useMemo<DrugListRow[]>(() => {
    const sectionMeta: Array<{ bucket: DrugMatchBucket; title: string; description: string }> = [
      {
        bucket: 'exact',
        title: 'Exact Salt Match',
        description: 'Products where the salt set exactly matches your typed salts.',
      },
      {
        bucket: 'contains_all',
        title: 'Contains Typed Salts + Extras',
        description: 'Products with all typed salts plus additional combination salts.',
      },
      {
        bucket: 'combination',
        title: 'Combination / Partial Matches',
        description: 'Products that match one or more typed salts.',
      },
    ];

    const rows: DrugListRow[] = [];
    sectionMeta.forEach(({ bucket, title, description }) => {
      const matches = groupedDrugMatches[bucket];
      if (matches.length === 0) return;
      rows.push({ id: `header-${bucket}`, type: 'header', title, description });
      matches.forEach((match) => {
        rows.push({ id: `drug-${match.drug.id}`, type: 'drug', match });
      });
    });
    return rows;
  }, [groupedDrugMatches]);

  const selectedDrug = useMemo(
    () => (selectedDrugId ? DRUG_CATALOG.find((drug) => drug.id === selectedDrugId) ?? null : null),
    [selectedDrugId],
  );

  const headerTitle = (() => {
    if (route.name === 'list') return suitableMode ? 'Patient Cohort' : 'Patients';
    if (route.name === 'addPatient') return 'Add Patient';
    if (route.name === 'whatsNew') return "What's New";
    if (route.name === 'whatsNewDetail') return selectedInsight?.name ?? "What's New";
    if (route.name === 'edit') {
      return routedPatient
        ? `${routedPatient.name} · ${displayPatientEmail(routedPatient)}`
        : 'Patient Details';
    }
    if (route.name === 'hcpList') return 'Ask/Refer an HCP';
    if (route.name === 'doctorProfile') return routedDoctor?.name ?? 'Doctor Profile';
    if (route.name === 'doctorChat') return routedDoctor?.name ?? 'Doctor Chat';
    if (route.name === 'visitDetails') return 'Visit Details';
    return route.visitId ? 'Edit Visit' : 'Add Visit';
  })();

  const headerSubtitle = (() => {
    if (suitableMode && route.name === 'list') {
      return suitableSource?.brand
        ? `${suitableSource.brand} · ${highMatchPatients.length} high matches`
        : `${highMatchPatients.length} high matches`;
    }
    if (route.name === 'list' && patientFocusSource === 'drug' && insightFocusLabel) {
      return `Relevant patients for ${insightFocusLabel}`;
    }
    if (route.name === 'list') return `${patients.length} patients`;
    if (route.name === 'addPatient') return 'All fields are optional';
    if (route.name === 'whatsNew') {
      return `${filteredInsights.length} evidence-backed updates`;
    }
    if (route.name === 'whatsNewDetail') {
      return selectedInsight
        ? `${selectedInsight.category} · ${selectedInsight.therapeuticArea}`
        : 'Therapeutic update';
    }
    if (route.name === 'edit') return 'Patient details and visit history';
    if (route.name === 'hcpList') return 'Search by doctor name or specialization';
    if (route.name === 'doctorProfile') {
      return routedDoctor
        ? `${routedDoctor.specializations.slice(0, 2).join(' · ')}`
        : 'Doctor details';
    }
    if (route.name === 'doctorChat') return routedDoctor?.designation ?? 'Consult thread';
    if (route.name === 'visitDetails') {
      return activeVisit ? `${activeVisit.date} · ${activeVisit.diagnosis}` : 'Past visit snapshot';
    }
    return route.visitId
      ? 'Update historical visit details'
      : routedPatient
        ? `${routedPatient.name} · ${displayPatientEmail(routedPatient)}`
        : 'Visit intake';
  })();

  const notifyPatients = (targets: PatientProfile[], label: string) => {
    if (targets.length === 0) {
      setInfoMessage('No suitable patients to notify.');
      setSelectedPatientId(null);
      return;
    }
    const names = targets.map((p) => p.name).join(', ');
    setInfoMessage(`${label}: ${names}.`);
    setSelectedPatientId(null);
  };

  const openAddVisit = (patientId: string, visitId?: string) => {
    const patient = patients.find((entry) => entry.id === patientId);
    if (!patient) return;
    const visitToEdit =
      visitId ? patient.pastVisits.find((visit) => visit.id === visitId) : undefined;
    setVisitForm(makeVisitForm(patient, visitToEdit));
    setSymptomDraft(EMPTY_SYMPTOM);
    setAddSymptomOpen(false);
    setFollowUpPromptOpen(false);
    setFollowUpFrequencyIndex(0);
    setFollowUpTopic('');
    setInfoMessage(null);
    setSelectedPatientId(null);
    if (visitToEdit) {
      setRoute({ name: 'addVisit', patientId, visitId: visitToEdit.id });
      return;
    }
    setRoute({ name: 'addVisit', patientId });
  };

  const openAddPatient = () => {
    setInfoMessage(null);
    setSelectedPatientId(null);
    setPatientForm(makePatientForm());
    setRoute({ name: 'addPatient' });
  };

  const openEdit = (patientId: string) => {
    const patient = patients.find((entry) => entry.id === patientId);
    if (!patient) return;
    setInfoMessage(null);
    setSelectedPatientId(null);
    setPatientForm(makePatientForm(patient));
    setRoute({ name: 'edit', patientId });
  };

  const openVisitDetails = (patientId: string, visitId: string) => {
    setInfoMessage(null);
    setRoute({ name: 'visitDetails', patientId, visitId });
  };

  const openHcpReferral = (patientId: string) => {
    const patient = patients.find((entry) => entry.id === patientId) ?? null;
    setInfoMessage(null);
    setReferralSuccessMessage(null);
    setConfirmReferralOpen(false);
    setSelectedPatientId(null);

    if (!patient || !/^P\d+/i.test(patient.id)) {
      setInfoMessage('Formal referral needs an API-backed patient on your panel.');
      return;
    }
    if (!currentDoctor) {
      setInfoMessage('Could not load your doctor profile for referrals. Is the API running?');
      return;
    }
    setFormalReferralPatient(patient);
  };

  const openDoctorProfile = (patientId: string, doctorId: string) => {
    setInfoMessage(null);
    setReferralSuccessMessage(null);
    setConfirmReferralOpen(false);
    setRoute({ name: 'doctorProfile', patientId, doctorId });
  };

  const openDoctorChat = (patientId: string, doctorId: string) => {
    const doctor = hcpCatalog.find((entry) => entry.id === doctorId);
    if (!doctor) return;
    setRoute({ name: 'doctorChat', patientId, doctorId });
    const existing = consultThreads.find((thread) => thread.id === doctorId);
    const ensure = existing?.threadId
      ? Promise.resolve(existing)
      : openConsultThread(doctorId).then((opened) => {
          const next: DoctorThread = {
            ...doctor,
            ...opened,
            id: doctor.id,
            threadId: opened.threadId,
            messages: [],
          };
          setConsultThreads((current) => [next, ...current.filter((thread) => thread.id !== doctorId)]);
          return next;
        });
    ensure
      .then((thread) => loadThreadMessages(thread.threadId).then((messages) => ({ thread, messages })))
      .then(({ thread, messages }) => {
        setConsultThreads((current) =>
          current.map((entry) =>
            entry.id === doctorId || entry.threadId === thread.threadId ? { ...entry, messages } : entry,
          ),
        );
      })
      .catch(() => setInfoMessage('Could not open that consult.'));
  };

  const openWhatsNewFeed = () => {
    setSelectedPatientId(null);
    setInfoMessage(null);
    setRoute({ name: 'whatsNew' });
  };

  const openInsightDetails = (insightId: string) => {
    setRoute({ name: 'whatsNewDetail', insightId });
  };

  const openExternalSource = (url: string) => {
    Linking.openURL(url).catch(() => {
      setInfoMessage('Could not open source link on this device.');
    });
  };

  const openRelevantPatientsFromInsight = (insight: WhatsNewInsight) => {
    const relevantPatients = getRelevantPatientsForInsight(patients, insight);
    setPatientFocusSource('insight');
    setDrugFocusReturnState(null);
    setInsightFocusPatientIds(relevantPatients.map((patient) => patient.id));
    setInsightFocusLabel(insight.name);
    setQuery('');
    setSearchInlineActive(true);
    setSearchMode('patients');
    setRoute({ name: 'list' });

    if (relevantPatients.length === 0) {
      setInfoMessage(`No matching patients currently surfaced for ${insight.name}.`);
      return;
    }
    setInfoMessage(
      `${insight.name} relevant patients: ${relevantPatients.map((patient) => patient.name).join(', ')}.`,
    );
  };

  const openRelevantPatientsFromDrug = useCallback(
    (drug: (typeof DRUG_CATALOG)[number]) => {
      clearDrugSearchDelay();
      const relevantPatients = getRelevantPatientsForDrug(patients, drug);
      setPatientFocusSource('drug');
      setDrugFocusReturnState({
        draftQuery: drugSaltQuery,
        submittedQuery: drugSubmittedSaltQuery,
      });
      setInsightFocusPatientIds(relevantPatients.map((patient) => patient.id));
      setInsightFocusLabel(drug.productName);
      setSearchMode('patients');
      setSearchInlineActive(true);
      setSearchLayerVisible(false);
      setSearchOverlayState('idle');
      setStrengthFilterOpen(false);
      setDrugSearchLoading(false);
      setSelectedDrugId(null);
      setQuery('');
      setRoute({ name: 'list' });

      if (relevantPatients.length === 0) {
        setInfoMessage(`No relevant patients currently surfaced for ${drug.productName}.`);
        return;
      }

      setInfoMessage(
        `${drug.productName} relevant patients: ${relevantPatients
          .map((patient) => patient.name)
          .join(', ')}.`,
      );
    },
    [clearDrugSearchDelay, drugSaltQuery, drugSubmittedSaltQuery, patients],
  );

  const runDrugSearch = useCallback(() => {
    clearDrugSearchDelay();
    Keyboard.dismiss();
    setDrugSearchLoading(true);
    setSelectedDrugId(null);
    const submittedQuery = drugSaltQuery.trim();
    drugSearchDelayRef.current = setTimeout(() => {
      setDrugSubmittedSaltQuery(submittedQuery);
      setDrugSearchLoading(false);
      drugSearchDelayRef.current = null;
    }, 1000);
  }, [clearDrugSearchDelay, drugSaltQuery]);

  const sendDoctorMessage = (text: string) => {
    if (route.name !== 'doctorChat') return;
    const thread = consultThreads.find((entry) => entry.id === route.doctorId);
    if (!thread?.threadId) return;
    const localId = `local-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: localId,
      senderId: CURRENT_DOCTOR_KEY,
      text,
      timestamp: 'Sending…',
      status: 'pending',
    };
    setConsultThreads((current) =>
      current.map((entry) =>
        entry.threadId === thread.threadId
          ? { ...entry, messages: [...entry.messages, optimistic], lastMessage: text }
          : entry,
      ),
    );
    const post = (attempt: number) => {
      sendConsultMessage(thread.threadId, text)
        .then((saved) => {
          setConsultThreads((current) =>
            current.map((entry) =>
              entry.threadId === thread.threadId
                ? {
                    ...entry,
                    lastMessage: saved.text,
                    messages: [...entry.messages.filter((message) => message.id !== localId), saved],
                  }
                : entry,
            ),
          );
        })
        .catch(() => {
          if (attempt < 1) {
            post(attempt + 1);
            return;
          }
          setInfoMessage('Could not send that consult message.');
        });
    };
    post(0);
  };

  const openRecordPdf = useCallback((patientId: string) => {
    const url = recordPdfUrl(patientId);
    if (Platform.OS === 'web' && typeof globalThis.open === 'function') {
      globalThis.open(url, '_blank');
      return;
    }
    Linking.openURL(url).catch(() => setInfoMessage('Could not open the medical record.'));
  }, [setInfoMessage]);

  const handleAction = (action: ActionKey) => {
    if (!selectedPatient) return;
    if (action === 'edit-patient') {
      openEdit(selectedPatient.id);
      return;
    }
    if (action === 'add-visit') {
      openAddVisit(selectedPatient.id);
      return;
    }
    if (action === 'send-notification') {
      setPdfOpen(false);
      setPdfPreparing(false);
      setPdfReady(false);
      setPdfSendBusy(false);
      setPdfSummarySource(null);
      setEmailPrompt('');
      setEmailOpen(true);
      return;
    }
    if (action === 'find-similar') {
      const patientId = selectedPatient.id;
      setSelectedPatientId(null);
      setSelectedSimilarMatchId(null);
      setSimilarLoading(true);
      setSimilarAnalysis(makeEmptySimilarAnalysis());
      loadSimilarCases(patientId)
        .then(setSimilarAnalysis)
        .catch(() => {
          setSimilarAnalysis(null);
          setInfoMessage('Could not load similar patients.');
        })
        .finally(() => setSimilarLoading(false));
      return;
    }
    if (action === 'generate-pdf') {
      setEmailOpen(false);
      setPdfOpen(true);
      setPdfPreparing(true);
      setPdfReady(false);
      setPdfSendBusy(false);
      setPdfSummarySource(null);
      prepareSummarizedRecordPdf(selectedPatient.id)
        .then((result) => {
          setPdfSummarySource(result.visit_summary_source);
          setPdfReady(true);
        })
        .catch(() => {
          setPdfOpen(false);
          setInfoMessage('Could not generate summarized PDF.');
        })
        .finally(() => setPdfPreparing(false));
      return;
    }
    if (action === 'ask-refer-hcp') {
      openHcpReferral(selectedPatient.id);
      setSelectedPatientId(null);
      return;
    }

    const label = sheetActions.find((entry) => entry.key === action)?.label ?? 'Action';
    setInfoMessage(`${label} is ready for backend wiring.`);
    setSelectedPatientId(null);
  };

  const goBack = () => {
    if (similarAnalysis) {
      setSelectedSimilarMatchId(null);
      setSimilarAnalysis(null);
      return;
    }
    if (selectedPatientId) {
      setSelectedPatientId(null);
      return;
    }
    if (route.name === 'list') {
      if (patientFocusSource === 'drug') {
        clearDrugSearchDelay();
        setPatientFocusSource(null);
        setInsightFocusPatientIds([]);
        setInsightFocusLabel(null);
        setSearchInlineActive(true);
        setSearchMode('drugs');
        setQuery('');
        setStrengthFilterOpen(false);
        setSelectedDrugId(null);
        setDrugSearchLoading(false);
        if (drugFocusReturnState) {
          setDrugSaltQuery(drugFocusReturnState.draftQuery);
          setDrugSubmittedSaltQuery(drugFocusReturnState.submittedQuery);
        }
        setDrugFocusReturnState(null);
        return;
      }
      if (suitableMode) exitSuitableMode();
      return;
    }
    if (route.name === 'whatsNew') {
      setRoute({ name: 'list' });
      return;
    }
    if (route.name === 'whatsNewDetail') {
      setRoute({ name: 'whatsNew' });
      return;
    }
    if (route.name === 'addPatient') {
      setPatientForm(null);
      setRoute({ name: 'list' });
      return;
    }
    if (route.name === 'addVisit' || route.name === 'visitDetails') {
      setAddSymptomOpen(false);
      setFollowUpPromptOpen(false);
      setVisitSaveBusy(false);
      setRoute({ name: 'edit', patientId: route.patientId });
      return;
    }
    if (route.name === 'hcpList') {
      setRoute({ name: 'edit', patientId: route.patientId });
      return;
    }
    if (route.name === 'doctorProfile') {
      setConfirmReferralOpen(false);
      setRoute({ name: 'hcpList', patientId: route.patientId });
      return;
    }
    if (route.name === 'doctorChat') {
      setRoute({ name: 'doctorProfile', patientId: route.patientId, doctorId: route.doctorId });
      return;
    }
    setRoute({ name: 'list' });
  };

  const updateVisitForm = <K extends keyof VisitForm>(
    key: K,
    value: VisitForm[K],
  ) => {
    setVisitForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const updatePatientForm = <K extends keyof PatientForm>(
    key: K,
    value: PatientForm[K],
  ) => {
    setPatientForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const patientPayloadFromForm = (form: PatientForm) => {
    const ageNumber = Number.parseInt(form.age.trim(), 10);
    return {
      name: form.name,
      emailAddress: form.email,
      age: Number.isFinite(ageNumber) ? ageNumber : undefined,
      sex: form.sex,
      diagnosis: form.diagnosis,
      relevantMedicalHistory: form.relevantMedicalHistory,
      familyMedicalHistory: form.familyMedicalHistory,
      currentMedications: form.currentMedications,
      alcoholUse: form.alcoholUse,
      smokingStatus: form.smokingStatus,
      immuneStatus: form.immuneStatus,
      pregnancyStatus: form.pregnancyStatus,
      labResults: form.labResults,
    };
  };

  const addSymptom = () => {
    const name = symptomDraft.name.trim();
    if (!name) return;
    const nextSymptom: SymptomEntry = {
      id: `sym-${Date.now()}`,
      name,
      duration: symptomDraft.duration.trim() || 'Not specified',
      frequency: symptomDraft.frequency.trim() || 'Not specified',
      trigger: symptomDraft.trigger.trim() || 'Not specified',
      onset: symptomDraft.onset,
    };

    setVisitForm((current) =>
      current ? { ...current, symptoms: [...current.symptoms, nextSymptom] } : current,
    );
    setSymptomDraft(EMPTY_SYMPTOM);
    setAddSymptomOpen(false);
  };

  const saveVisit = (sendFollowUpEmails: boolean) => {
    if (route.name !== 'addVisit' || !visitForm) return;
    if (visitSaveBusy) return;
    const isEditingPastVisit = Boolean(route.visitId);
    const enteredSymptoms = visitForm.symptoms;
    const diagnosis = visitForm.diagnosis.trim();
    const notes = visitForm.notes.trim();
    const medications = visitForm.currentMedications.trim();
    const labs = visitForm.labResults.trim();
    const selectedFollowUpFrequency =
      FOLLOW_UP_FREQUENCY_OPTIONS[followUpFrequencyIndex] ?? FOLLOW_UP_FREQUENCY_OPTIONS[0];
    const followUpTopicText = followUpTopic.trim();
    const firstSymptoms = visitForm.symptoms
      .slice(0, 2)
      .map((symptom) => symptom.name)
      .join(', ');
    const existingVisit =
      route.visitId && routedPatient
        ? routedPatient.pastVisits.find((visit) => visit.id === route.visitId) ?? null
        : null;
    const visitSummary =
      notes ||
      (firstSymptoms.length > 0
        ? `Symptoms tracked: ${firstSymptoms}. Intake fields updated.`
        : existingVisit?.summary ?? 'Visit details updated from latest intake.');

    setVisitSaveBusy(true);
    savePatientVisit(
      route.patientId,
      {
        diagnosis:
          diagnosis ||
          existingVisit?.diagnosis ||
          routedPatient?.diagnosis ||
          'Follow-up assessment',
        summary: visitSummary,
        symptoms: enteredSymptoms.map((symptom) => ({ ...symptom })),
        currentMedications: medications || routedPatient?.currentMedications || 'Medication list reconciled.',
        alcoholUse: visitForm.alcoholUse,
        smokingStatus: visitForm.smokingStatus,
        immuneStatus: visitForm.immuneStatus,
        pregnancyStatus: visitForm.pregnancyStatus,
        labResults: labs || routedPatient?.labResults || 'Labs reviewed.',
      },
      route.visitId,
    )
      .then((updatedPatient) => {
        const baseMessage = isEditingPastVisit
          ? 'Past visit updated successfully.'
          : 'Visit saved and appended to past visit details.';
        setPatients((current) =>
          current.map((patient) => (patient.id === updatedPatient.id ? updatedPatient : patient)),
        );
        if (sendFollowUpEmails) {
          const followUpMessage = followUpTopicText
            ? ` Follow-up emails scheduled every ${selectedFollowUpFrequency} about: ${followUpTopicText}`
            : ` Follow-up emails scheduled every ${selectedFollowUpFrequency}.`;
          setInfoMessage(`${baseMessage}${followUpMessage}`);
        } else {
          setInfoMessage(baseMessage);
        }
        setAddSymptomOpen(false);
        setFollowUpPromptOpen(false);
        setFollowUpFrequencyIndex(0);
        setFollowUpTopic('');
        setRoute({ name: 'edit', patientId: route.patientId });
      })
      .catch((error) => {
        setInfoMessage(error instanceof Error ? error.message : 'Could not save visit.');
      })
      .finally(() => {
        setVisitSaveBusy(false);
      });
  };

  const openVisitSavePrompt = () => {
    if (route.name !== 'addVisit' || !visitForm) return;
    if (visitSaveBusy) return;
    setFollowUpPromptOpen(true);
  };

  const saveEditedPatient = () => {
    if (route.name !== 'edit' || !routedPatient || !patientForm) return;
    savePatientDetails(routedPatient.id, patientPayloadFromForm(patientForm))
      .then((updatedPatient) => {
        setPatients((current) =>
          current.map((patient) => (patient.id === updatedPatient.id ? updatedPatient : patient)),
        );
        setPatientForm(makePatientForm(updatedPatient));
        setInfoMessage('Patient details updated successfully.');
      })
      .catch((error) => {
        setInfoMessage(error instanceof Error ? error.message : 'Could not update patient details.');
      });
  };

  const saveNewPatient = () => {
    if (route.name !== 'addPatient' || !patientForm) return;
    createPatient(patientPayloadFromForm(patientForm))
      .then((createdPatient) => {
        setPatients((current) => [createdPatient, ...current]);
        setPatientForm(makePatientForm(createdPatient));
        setRoute({ name: 'edit', patientId: createdPatient.id });
        setInfoMessage('Patient created successfully.');
      })
      .catch((error) => {
        setInfoMessage(error instanceof Error ? error.message : 'Could not create patient.');
      });
  };

  const confirmDoctorReferral = () => {
    if (route.name !== 'doctorProfile' || !routedDoctor || !routedPatient) return;
    setConfirmReferralOpen(false);
    setReferralSuccessMessage(
      `Referral sent to ${routedPatient.name}. Email delivered with ${routedDoctor.name}'s details and medical history shared immediately.`,
    );
  };

  const openExternalLink = useCallback((url: string, failureMessage: string) => {
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    Linking.openURL(normalizedUrl).catch(() => {
      setInfoMessage(failureMessage);
    });
  }, []);

  const hideSearchLayer = useCallback(() => {
    setSearchOverlayState('idle');
    menuDrugsPillProgress.value = withTiming(0, { duration: 120 });
    menuPatientsPillProgress.value = withTiming(0, { duration: 120 });
    menuBackdropProgress.value = withTiming(0, { duration: 200 });
    setSearchLayerVisible(false);
  }, [
    menuBackdropProgress,
    menuDrugsPillProgress,
    menuPatientsPillProgress,
  ]);

  const openSearchMenu = useCallback(() => {
    if (suitableMode || route.name !== 'list') return;
    setSearchLayerVisible(true);
    setSearchOverlayState('menu');
    setStrengthFilterOpen(false);
    menuBackdropProgress.value = withTiming(1, { duration: 200 });
    menuDrugsPillProgress.value = withTiming(1, { duration: 180 });
    menuPatientsPillProgress.value = withTiming(1, { duration: 180 });
  }, [
    menuBackdropProgress,
    menuDrugsPillProgress,
    menuPatientsPillProgress,
    route.name,
    suitableMode,
  ]);

  const activateInlineSearch = useCallback(
    (mode: SearchMode) => {
      clearDrugSearchDelay();
      setSearchMode(mode);
      setSearchInlineActive(true);
      setStrengthFilterOpen(false);
      setSelectedDrugId(null);
      setDrugSearchLoading(false);
      setSearchLayerVisible(false);
      setSearchOverlayState('idle');
      setPatientFocusSource(null);
      setDrugFocusReturnState(null);
      setInsightFocusPatientIds([]);
      setInsightFocusLabel(null);
      if (mode === 'patients') {
        setDrugSaltQuery('');
        setDrugSubmittedSaltQuery('');
      } else {
        setQuery('');
        setDrugSaltQuery('');
        setDrugSubmittedSaltQuery('');
      }
      menuBackdropProgress.value = withTiming(0, { duration: 120 });
      menuDrugsPillProgress.value = withTiming(0, { duration: 120 });
      menuPatientsPillProgress.value = withTiming(0, { duration: 120 });
    },
    [clearDrugSearchDelay, menuBackdropProgress, menuDrugsPillProgress, menuPatientsPillProgress],
  );

  const dismissInlineSearch = useCallback(() => {
    clearDrugSearchDelay();
    setSearchInlineActive(false);
    setSearchMode('patients');
    setQuery('');
    setDrugSaltQuery('');
    setDrugSubmittedSaltQuery('');
    setDrugSearchLoading(false);
    setStrengthFilterOpen(false);
    setSelectedStrengths([]);
    setStrengthFilterText('');
    setSelectedDrugId(null);
    setPatientFocusSource(null);
    setDrugFocusReturnState(null);
    setInsightFocusPatientIds([]);
    setInsightFocusLabel(null);
  }, [clearDrugSearchDelay]);

  useEffect(() => {
    if (route.name !== 'list' || suitableMode) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (searchLayerVisible && searchOverlayState === 'menu') {
        hideSearchLayer();
        return true;
      }
      if (similarAnalysis || selectedPatientId) {
        goBack();
        return true;
      }
      if (patientFocusSource === 'drug') {
        goBack();
        return true;
      }
      return false;
    });

    return () => {
      subscription.remove();
    };
  }, [
    hideSearchLayer,
    goBack,
    patientFocusSource,
    route.name,
    searchLayerVisible,
    searchOverlayState,
    selectedPatientId,
    similarAnalysis,
    suitableMode,
  ]);

  const toggleStrength = (strength: string) => {
    setSelectedStrengths((current) =>
      current.includes(strength)
        ? current.filter((item) => item !== strength)
        : [...current, strength],
    );
  };

  const clearDrugFilters = () => {
    setSelectedStrengths([]);
    setStrengthFilterText('');
  };

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: menuBackdropProgress.value,
  }));

  const drugsPillAnimatedStyle = useAnimatedStyle(() => ({
    opacity: menuDrugsPillProgress.value,
    transform: [
      { translateX: (1 - menuDrugsPillProgress.value) * -26 },
      { scale: 0.8 + menuDrugsPillProgress.value * 0.2 },
    ],
  }));

  const patientsPillAnimatedStyle = useAnimatedStyle(() => ({
    opacity: menuPatientsPillProgress.value,
    transform: [
      { translateX: (1 - menuPatientsPillProgress.value) * -26 },
      { scale: 0.8 + menuPatientsPillProgress.value * 0.2 },
    ],
  }));

  const renderDrugRow = ({ item }: { item: DrugListRow }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.drugSectionHeader}>
          <Text style={styles.drugSectionHeaderTitle}>{item.title}</Text>
          <Text style={styles.drugSectionHeaderText}>{item.description}</Text>
        </View>
      );
    }

    const { drug } = item.match;
    return (
      <View style={styles.drugResultCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open details for ${drug.productName}`}
          onPress={() => {
            Keyboard.dismiss();
            setSelectedDrugId(drug.id);
          }}
        >
          <Image source={drug.image} style={styles.drugResultImage} resizeMode="cover" />
          <View style={styles.drugResultBody}>
            <Text style={styles.drugResultName}>{drug.productName}</Text>
            <Text style={styles.drugResultCompany}>{drug.companyName}</Text>
            <Text style={styles.drugResultSummary}>{drug.summary}</Text>
            <Text style={styles.drugResultSalts}>
              {drug.salts.map((salt) => `${salt.name} ${salt.strength}`).join(' + ')}
            </Text>
          </View>
        </Pressable>
        <View style={styles.drugResultLinksWrap}>
          <View style={styles.drugResultLinks}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Find relevant patients for ${drug.productName}`}
              onPress={() => {
                openRelevantPatientsFromDrug(drug);
              }}
              style={styles.drugFindPatientsButton}
            >
              <Text style={styles.drugFindPatientsButtonText}>Find relevant patients</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open website for ${drug.productName}`}
              onPress={() => {
                openExternalLink(
                  drug.websiteUrl,
                  `Could not open ${drug.productName} website on this device.`,
                );
              }}
              style={styles.drugWebsiteButton}
            >
              <Text style={styles.drugWebsiteButtonText}>Drug website</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  const showBack = route.name !== 'list' || suitableMode || patientFocusSource === 'drug';
  const boxNonePointerEvents: 'box-none' = 'box-none';
  const selectedFollowUpFrequency =
    FOLLOW_UP_FREQUENCY_OPTIONS[followUpFrequencyIndex] ?? FOLLOW_UP_FREQUENCY_OPTIONS[0];
  const followUpProgressPercent =
    FOLLOW_UP_FREQUENCY_OPTIONS.length > 1
      ? (followUpFrequencyIndex / (FOLLOW_UP_FREQUENCY_OPTIONS.length - 1)) * 100
      : 0;

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.header,
          suitableMode && styles.headerSuitable,
          { paddingTop: Math.max(insets.top, 12) },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            suitableMode && route.name === 'list'
              ? 'Exit cohort analyzer'
              : patientFocusSource === 'drug' && route.name === 'list'
                ? 'Go back to drug results'
              : route.name === 'list'
                ? 'Patients'
                : 'Go back'
          }
          onPress={showBack ? goBack : undefined}
          disabled={!showBack}
          style={styles.headerLeft}
        >
          {showBack ? (
            <ChevronLeftIcon color={colors.white} size={22} />
          ) : null}
          <View style={styles.headerTitles}>
            <Text
              style={[styles.headerTitle, suitableMode && styles.headerTitleSuitable]}
              numberOfLines={1}
            >
              {headerTitle}
            </Text>
            <Text
              style={[styles.headerSubtitle, suitableMode && styles.headerSubtitleSuitable]}
              numberOfLines={1}
            >
              {headerSubtitle}
            </Text>
          </View>
        </Pressable>
        {suitableMode && route.name === 'list' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notify all suitable patients"
            onPress={() =>
              notifyPatients(
                highMatchPatients,
                `Notified ${highMatchPatients.length} suitable patient${
                  highMatchPatients.length === 1 ? '' : 's'
                }`,
              )
            }
            style={({ pressed }) => [
              styles.notifyAllBtn,
              pressed && styles.notifyAllBtnPressed,
            ]}
          >
            <Text style={styles.notifyAllBtnText}>Notify all suitable</Text>
          </Pressable>
        ) : !suitableMode && route.name === 'list' && patientFocusSource !== 'drug' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open what's new feed"
            onPress={openWhatsNewFeed}
            style={({ pressed }) => [styles.whatsNewBtn, pressed && styles.whatsNewBtnPressed]}
          >
            <Image source={WHATS_NEW_BUTTON_IMAGE} style={styles.whatsNewBtnImage} resizeMode="contain" />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.body}>
        {route.name === 'list' ? (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <ScrollView
              style={styles.flex}
              contentContainerStyle={[
                styles.listContent,
                !suitableMode &&
                  (searchInlineActive
                    ? styles.listContentWithInlineSearch
                    : styles.listContentWithSearchLauncher),
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
            >
              {suitableMode && suitableSource ? (
                <View style={styles.trialBlock}>
                  <Text style={styles.trialEyebrow}>SELECTED TRIAL DESK</Text>
                  <View style={styles.trialCard}>
                    <View style={styles.trialAccent} />
                    <View style={styles.trialBody}>
                      <Text style={styles.trialTitle}>{suitableSource.title}</Text>
                      <Text style={styles.trialMeta}>
                        {suitableSource.preview ||
                          `${suitableSource.brand} · Cohort match`}
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {suitableMode ? (
                <View style={styles.cohortHeader}>
                  <Text style={styles.cohortTitle}>Patient Cohort Analyzer</Text>
                  <Text style={styles.cohortLegend}>
                    Red Outline = High Match Relevance
                  </Text>
                </View>
              ) : null}

              {!suitableMode &&
              searchMode === 'patients' &&
              insightFocusLabel &&
              (insightFocusPatientIds.length > 0 || patientFocusSource === 'drug') ? (
                <View style={styles.focusBanner}>
                  <Text style={styles.focusBannerEyebrow}>
                    {patientFocusSource === 'drug' ? 'DRUG MATCH' : "WHAT'S NEW MATCH"}
                  </Text>
                  <Text style={styles.focusBannerText}>
                    {patientFocusSource === 'drug'
                      ? `Prioritizing patients relevant to ${insightFocusLabel}.`
                      : `Prioritizing patients relevant to ${insightFocusLabel}.`}
                  </Text>
                </View>
              ) : null}

              {infoMessage ? (
                <View style={styles.infoBanner}>
                  <Text style={styles.infoBannerText}>{infoMessage}</Text>
                </View>
              ) : null}

              {!suitableMode && searchInlineActive && searchMode === 'drugs' ? (
                drugSearchLoading ? (
                  <View style={styles.searchEmptyStateInline}>
                    <ActivityIndicator size="small" color={colors.accentPurple} />
                    <Text style={styles.searchEmptyStateTitle}>Searching drugs...</Text>
                    <Text style={styles.searchEmptyStateText}>
                      Matching active ingredients across the catalog.
                    </Text>
                  </View>
                ) : drugSubmittedSaltQuery.trim().length === 0 ? (
                  <View style={styles.searchEmptyStateInline}>
                    <Text style={styles.searchEmptyStateTitle}>Search Active Ingredient</Text>
                    <Text style={styles.searchEmptyStateText}>
                      Add one or more salts (comma-separated), then tap Search.
                    </Text>
                  </View>
                ) : drugResultRows.length === 0 ? (
                  <View style={styles.searchEmptyStateInline}>
                    <Text style={styles.searchEmptyStateTitle}>No matching drugs</Text>
                    <Text style={styles.searchEmptyStateText}>
                      Try different salts or clear the strength filters.
                    </Text>
                  </View>
                ) : (
                  drugResultRows.map((row) => (
                    <View key={row.id}>{renderDrugRow({ item: row })}</View>
                  ))
                )
              ) : (
                filteredPatients.map((patient) => {
                  const isHighMatch = suitableMode
                    ? HIGH_MATCH_SET.has(patient.id)
                    : insightFocusPatientIds.includes(patient.id);
                  return (
                    <Pressable
                      key={patient.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open actions for ${patient.name}`}
                      onPress={() => {
                        Keyboard.dismiss();
                        setSelectedPatientId(patient.id);
                      }}
                      style={[
                        styles.patientCard,
                        isHighMatch && styles.patientCardMatch,
                      ]}
                    >
                      <View style={styles.patientCardHead}>
                        <Text
                          style={[
                            styles.patientName,
                            isHighMatch && styles.patientNameMatch,
                          ]}
                        >
                          {patient.name}
                        </Text>
                        <View style={styles.patientCardHeadRight}>
                          <Text style={styles.patientAge}>Age {patient.age}</Text>
                          {isHighMatch ? (
                            <View style={styles.matchBadge}>
                              <Text style={styles.matchBadgeText}>MATCH</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <Text style={styles.patientEmail}>
                        {displayPatientEmail(patient)}
                      </Text>

                      <View style={styles.symptomsRow}>
                        {patient.symptoms.slice(0, 3).map((symptom) => (
                          <View
                            key={symptom.id}
                            style={[
                              styles.symptomPill,
                              isHighMatch && styles.symptomPillMatch,
                            ]}
                          >
                            <Text
                              style={[
                                styles.symptomPillText,
                                isHighMatch && styles.symptomPillTextMatch,
                              ]}
                            >
                              {symptom.name}
                            </Text>
                          </View>
                        ))}
                      </View>

                      <Text style={styles.metaText}>Dx: {patient.diagnosis}</Text>
                      <Text style={styles.metaText}>Rx: {patient.prescription}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            {!suitableMode ? (
              <View pointerEvents={boxNonePointerEvents} style={styles.searchLayerRoot}>
                <View
                  style={[
                    styles.searchInlineContainer,
                    searchInlineActive && styles.searchInlineContainerExpanded,
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open patient and drug search"
                    onPress={openSearchMenu}
                    style={({ pressed }) => [
                      styles.searchLauncherBtn,
                      pressed && styles.searchLauncherBtnPressed,
                    ]}
                  >
                    <SearchIcon color={colors.white} size={20} />
                  </Pressable>

                  {searchInlineActive ? (
                    <View style={styles.searchInlineBar}>
                      <TextInput
                        value={searchMode === 'drugs' ? drugSaltQuery : query}
                        onChangeText={(value) => {
                          if (searchMode === 'drugs') {
                            setDrugSaltQuery(value);
                            return;
                          }
                          setQuery(value);
                          if (value.trim().length > 0) {
                            setPatientFocusSource(null);
                            setDrugFocusReturnState(null);
                            setInsightFocusPatientIds([]);
                            setInsightFocusLabel(null);
                          }
                        }}
                        placeholder={
                          searchMode === 'drugs'
                            ? 'Search Active Ingredient (Salt(s) comma-seperated)'
                            : 'Search patients, diagnosis, or symptoms'
                        }
                        placeholderTextColor={colors.searchPlaceholder}
                        style={styles.searchInlineInput}
                        onSubmitEditing={() => {
                          if (searchMode === 'drugs') {
                            runDrugSearch();
                            return;
                          }
                          Keyboard.dismiss();
                        }}
                      />
                      {searchMode === 'drugs' ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Run drug active ingredient search"
                          onPress={runDrugSearch}
                          style={[
                            styles.searchPanelFilterBtn,
                            drugSaltQuery.trim().length > 0 && styles.searchPanelFilterBtnActive,
                          ]}
                        >
                          <SearchIcon color={colors.accentPurple} size={18} />
                        </Pressable>
                      ) : null}
                      {searchMode === 'drugs' ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Filter by dosage or strength"
                          onPress={() => setStrengthFilterOpen((current) => !current)}
                          style={[
                            styles.searchPanelFilterBtn,
                            (selectedStrengths.length > 0 ||
                              strengthFilterText.trim().length > 0) &&
                              styles.searchPanelFilterBtnActive,
                          ]}
                        >
                          <FilterIcon color={colors.accentPurple} size={18} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close search"
                        onPress={dismissInlineSearch}
                        style={styles.searchInlineCloseBtn}
                      >
                        <CloseIcon color={colors.textMuted} size={16} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                {searchLayerVisible ? (
                  <>
                    <Animated.View style={[styles.searchOverlay, backdropAnimatedStyle]}>
                      <BlurView
                        intensity={62}
                        tint="dark"
                        style={StyleSheet.absoluteFill}
                      />
                      <Pressable style={styles.searchOverlayDismiss} onPress={hideSearchLayer} />
                    </Animated.View>

                    <View pointerEvents={boxNonePointerEvents} style={styles.searchMenuAnchor}>
                      <Animated.View style={[styles.searchModePillWrap, drugsPillAnimatedStyle]}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Search drugs"
                          onPress={() => activateInlineSearch('drugs')}
                          style={[
                            styles.searchModePill,
                            searchMode === 'drugs' && styles.searchModePillActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.searchModePillText,
                              searchMode === 'drugs' && styles.searchModePillTextActive,
                            ]}
                          >
                            Drugs
                          </Text>
                        </Pressable>
                      </Animated.View>

                      <Animated.View
                        style={[styles.searchModePillWrapSecond, patientsPillAnimatedStyle]}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Search patients"
                          onPress={() => activateInlineSearch('patients')}
                          style={[
                            styles.searchModePill,
                            searchMode === 'patients' && styles.searchModePillActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.searchModePillText,
                              searchMode === 'patients' && styles.searchModePillTextActive,
                            ]}
                          >
                            Patients
                          </Text>
                        </Pressable>
                      </Animated.View>
                    </View>
                  </>
                ) : null}

                {searchInlineActive && searchMode === 'drugs' && strengthFilterOpen ? (
                  <View style={styles.searchFilterCardInline}>
                    <Text style={styles.searchFilterTitle}>Dosage / Strength</Text>
                    <View style={styles.searchFilterChipRow}>
                      {strengthOptions.map((strength) => {
                        const active = selectedStrengths.includes(strength);
                        return (
                          <Pressable
                            key={strength}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            onPress={() => toggleStrength(strength)}
                            style={[
                              styles.searchFilterChip,
                              active && styles.searchFilterChipActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.searchFilterChipText,
                                active && styles.searchFilterChipTextActive,
                              ]}
                            >
                              {strength}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <TextInput
                      value={strengthFilterText}
                      onChangeText={setStrengthFilterText}
                      placeholder="Custom strength text (e.g. 12.5 mg)"
                      placeholderTextColor={colors.searchPlaceholder}
                      style={styles.searchFilterInput}
                    />
                    <Pressable onPress={clearDrugFilters} style={styles.searchFilterClearBtn}>
                      <Text style={styles.searchFilterClearText}>Clear filters</Text>
                    </Pressable>
                  </View>
                ) : null}

                {selectedDrug ? (
                  <View pointerEvents={boxNonePointerEvents} style={styles.drugDetailRoot}>
                    <Pressable
                      style={styles.drugDetailDismiss}
                      onPress={() => setSelectedDrugId(null)}
                    />
                    <View style={styles.drugDetailCard}>
                      <View style={styles.drugDetailHeader}>
                        <View style={styles.drugDetailHeaderCopy}>
                          <Text style={styles.drugDetailKicker}>Drug Facts</Text>
                          <Text style={styles.drugDetailTitle}>{selectedDrug.productName}</Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Close drug details"
                          onPress={() => setSelectedDrugId(null)}
                          style={styles.closeCircle}
                        >
                          <CloseIcon color={colors.textMuted} size={18} />
                        </Pressable>
                      </View>
                      <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={styles.drugDetailContent}
                      >
                        <Image
                          source={selectedDrug.image}
                          style={styles.drugDetailImage}
                          resizeMode="cover"
                        />
                        <Text style={styles.drugDetailCompany}>{selectedDrug.companyName}</Text>
                        <Text style={styles.drugDetailSummary}>{selectedDrug.summary}</Text>

                        <View style={styles.drugDetailSection}>
                          <Text style={styles.drugDetailSectionTitle}>
                            {selectedDrug.facts.activeIngredientsTitle}
                          </Text>
                          {selectedDrug.salts.map((salt) => (
                            <Text key={`${selectedDrug.id}-${salt.name}`} style={styles.drugDetailText}>
                              {salt.name} {salt.strength} - {salt.purpose}
                            </Text>
                          ))}
                        </View>

                        <View style={styles.drugDetailSection}>
                          <Text style={styles.drugDetailSectionTitle}>Uses</Text>
                          {selectedDrug.facts.uses.map((item) => (
                            <Text key={`${selectedDrug.id}-use-${item}`} style={styles.drugDetailText}>
                              • {item}
                            </Text>
                          ))}
                        </View>

                        <View style={styles.drugDetailSection}>
                          <Text style={styles.drugDetailSectionTitle}>Warnings</Text>
                          {selectedDrug.facts.warnings.map((item) => (
                            <Text
                              key={`${selectedDrug.id}-warning-${item}`}
                              style={styles.drugDetailText}
                            >
                              • {item}
                            </Text>
                          ))}
                        </View>

                        <View style={styles.drugDetailSection}>
                          <Text style={styles.drugDetailSectionTitle}>Directions</Text>
                          {selectedDrug.facts.directions.map((item) => (
                            <Text
                              key={`${selectedDrug.id}-direction-${item}`}
                              style={styles.drugDetailText}
                            >
                              • {item}
                            </Text>
                          ))}
                        </View>

                        <View style={styles.drugDetailSection}>
                          <Text style={styles.drugDetailSectionTitle}>Other information</Text>
                          {selectedDrug.facts.otherInformation.map((item) => (
                            <Text key={`${selectedDrug.id}-info-${item}`} style={styles.drugDetailText}>
                              • {item}
                            </Text>
                          ))}
                        </View>

                        <View style={styles.drugDetailSection}>
                          <Text style={styles.drugDetailSectionTitle}>Inactive ingredients</Text>
                          <Text style={styles.drugDetailText}>
                            {selectedDrug.facts.inactiveIngredients.join(', ')}
                          </Text>
                        </View>

                        <View style={styles.drugDetailSection}>
                          <Text style={styles.drugDetailSectionTitle}>Questions or comments</Text>
                          <Text style={styles.drugDetailText}>
                            {selectedDrug.facts.questionsOrComments}
                          </Text>
                        </View>

                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Find relevant patients for ${selectedDrug.productName}`}
                          onPress={() => openRelevantPatientsFromDrug(selectedDrug)}
                          style={styles.secondaryButton}
                        >
                          <Text style={styles.secondaryButtonText}>Find Relevant Patients</Text>
                        </Pressable>

                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={`Open ${selectedDrug.productName} website`}
                          onPress={(event) => {
                            event.stopPropagation();
                            openExternalLink(
                              selectedDrug.websiteUrl,
                              `Could not open ${selectedDrug.productName} website on this device.`,
                            );
                          }}
                          style={styles.primaryButton}
                        >
                          <Text style={styles.primaryButtonText}>Visit Drug Website</Text>
                        </Pressable>
                      </ScrollView>
                    </View>
                  </View>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add a new patient"
                  onPress={openAddPatient}
                  style={({ pressed }) => [
                    styles.addPatientFab,
                    pressed && styles.addPatientFabPressed,
                  ]}
                >
                  <Text style={styles.addPatientFabText}>+</Text>
                </Pressable>
              </View>
            ) : null}
          </KeyboardAvoidingView>
        ) : route.name === 'whatsNew' ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.whatsNewContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.insightFilterRow}>
              {INSIGHT_FILTERS.map((filter) => {
                const active = insightFilter === filter;
                return (
                  <Pressable
                    key={filter}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setInsightFilter(filter)}
                    style={[styles.insightFilterPill, active && styles.insightFilterPillActive]}
                  >
                    <Text
                      style={[styles.insightFilterText, active && styles.insightFilterTextActive]}
                    >
                      {filter}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {filteredInsights.map((insight) => (
              <Pressable
                key={insight.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${insight.name} insight`}
                onPress={() => openInsightDetails(insight.id)}
                style={styles.insightCard}
              >
                <View
                  style={[
                    styles.insightAccent,
                    { backgroundColor: INSIGHT_ACCENT_BY_CATEGORY[insight.category] },
                  ]}
                />
                <View style={styles.insightMain}>
                  <View style={styles.insightTopRow}>
                    <Text style={styles.insightCategory}>{insight.category}</Text>
                    <Text style={styles.insightDate}>{insight.updateDate}</Text>
                  </View>
                  <Text style={styles.insightName}>{insight.name}</Text>
                  <Text style={styles.insightHeadline}>{insight.headline}</Text>
                  <Text style={styles.insightHook}>{insight.hook}</Text>
                  <Text style={styles.insightPlainLanguage}>{insight.plainLanguage}</Text>
                  <Text style={styles.chartCaption}>{insight.performanceGraphTitle}</Text>
                  <PerformanceComparisonChart
                    points={insight.performancePoints.slice(0, 2)}
                    treatmentLabel={insight.treatmentLabel}
                    comparatorLabel={insight.comparatorLabel}
                    compact
                  />
                  <View style={styles.insightFooter}>
                    <Text style={styles.insightHint}>Tap for full evidence graph and source links</Text>
                    <Text style={styles.insightCta}>{insight.ctaLabel}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : route.name === 'whatsNewDetail' && selectedInsight ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.whatsNewContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.insightDetailHero}>
              <View style={styles.insightDetailChip}>
                <Text style={styles.insightDetailChipText}>{selectedInsight.category}</Text>
              </View>
              <Text style={styles.insightDetailName}>{selectedInsight.name}</Text>
              <Text style={styles.insightDetailHeadline}>{selectedInsight.headline}</Text>
              <Text style={styles.insightDetailSummary}>{selectedInsight.summary}</Text>
              <Text style={styles.insightDetailPlainLanguage}>{selectedInsight.plainLanguage}</Text>
              <Text style={styles.insightDetailHint}>
                {selectedInsight.therapeuticArea} · Updated {selectedInsight.updateDate}
              </Text>
            </View>

            <View style={styles.insightSectionCard}>
              <Text style={styles.sectionTitle}>Evidence Performance Graph</Text>
              <Text style={styles.sectionHint}>{selectedInsight.performanceGraphTitle}</Text>
              <Text style={styles.sectionHint}>{PERFORMANCE_GRAPH_HELP_TEXT}</Text>
              <PerformanceComparisonChart
                points={selectedInsight.performancePoints}
                treatmentLabel={selectedInsight.treatmentLabel}
                comparatorLabel={selectedInsight.comparatorLabel}
              />
            </View>

            <View style={styles.insightSectionCard}>
              <Text style={styles.sectionTitle}>Benefits</Text>
              {selectedInsight.benefits.map((benefit) => (
                <View key={benefit} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{benefit}</Text>
                </View>
              ))}
            </View>

            <View style={styles.insightSectionCard}>
              <Text style={styles.sectionTitle}>Research Evidence</Text>
              {selectedInsight.evidence.map((entry) => (
                <View key={entry.source} style={styles.evidenceCard}>
                  <Text style={styles.evidenceSource}>{entry.source}</Text>
                  <Text style={styles.evidenceResult}>{entry.result}</Text>
                </View>
              ))}
            </View>

            <View style={styles.insightSectionCard}>
              <Text style={styles.sectionTitle}>Source Links</Text>
              {selectedInsight.externalSources.map((source) => (
                <Pressable
                  key={source.url}
                  accessibilityRole="link"
                  accessibilityLabel={`Open source: ${source.label}`}
                  onPress={() => openExternalSource(source.url)}
                  style={styles.sourceLinkRow}
                >
                  <Text style={styles.sourceLinkTitle}>{source.label}</Text>
                  <Text numberOfLines={1} style={styles.sourceLinkUrl}>
                    {source.url}
                  </Text>
                </Pressable>
              ))}
            </View>

            {selectedInsightGlossary.length > 0 ? (
              <View style={styles.insightSectionCard}>
                <Text style={styles.sectionTitle}>Metric Glossary</Text>
                {selectedInsightGlossary.map((item) => (
                  <View key={item.key} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{item.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.insightSectionCard}>
              <Text style={styles.sectionTitle}>Common Side Effects + Monitoring Notes</Text>
              <View style={styles.sideEffectWrap}>
                {selectedInsight.sideEffects.map((effect) => (
                  <View key={effect} style={styles.sideEffectPill}>
                    <Text style={styles.sideEffectText}>{effect}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.sectionHint}>{selectedInsight.relevantPatientHint}</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show relevant patients for ${selectedInsight.name}`}
              onPress={() => openRelevantPatientsFromInsight(selectedInsight)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Relevant Patients</Text>
            </Pressable>
          </ScrollView>
        ) : route.name === 'addPatient' && patientForm ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {infoMessage ? (
              <View style={styles.infoBanner}>
                <Text style={styles.infoBannerText}>{infoMessage}</Text>
              </View>
            ) : null}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>New Patient Details</Text>
              <Text style={styles.sectionHint}>All fields are optional.</Text>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                value={patientForm.name}
                onChangeText={(value) => updatePatientForm('name', value)}
                style={styles.input}
                placeholder="Patient name"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={patientForm.email}
                onChangeText={(value) => updatePatientForm('email', value)}
                style={styles.input}
                placeholder="Patient email"
                placeholderTextColor={colors.searchPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>Age</Text>
              <TextInput
                value={patientForm.age}
                onChangeText={(value) => updatePatientForm('age', value)}
                keyboardType="numeric"
                style={styles.input}
                placeholder="Age"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <ChoiceField
                label="Sex"
                value={patientForm.sex}
                options={['Female', 'Male']}
                onChange={(value) => updatePatientForm('sex', value)}
              />
              <Text style={styles.fieldLabel}>Diagnosis</Text>
              <TextInput
                value={patientForm.diagnosis}
                onChangeText={(value) => updatePatientForm('diagnosis', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Primary diagnosis or condition"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Relevant Medical History</Text>
              <TextInput
                value={patientForm.relevantMedicalHistory}
                onChangeText={(value) => updatePatientForm('relevantMedicalHistory', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Relevant medical history"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Family Medical History</Text>
              <TextInput
                value={patientForm.familyMedicalHistory}
                onChangeText={(value) => updatePatientForm('familyMedicalHistory', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Family medical history"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Current Medications</Text>
              <TextInput
                value={patientForm.currentMedications}
                onChangeText={(value) => updatePatientForm('currentMedications', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Current medicines"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <ChoiceField
                label="Alcohol"
                value={patientForm.alcoholUse}
                options={['None', 'Social', 'Daily']}
                onChange={(value) => updatePatientForm('alcoholUse', value)}
              />
              <ChoiceField
                label="Smoking"
                value={patientForm.smokingStatus}
                options={['Never smoker', 'Former smoker', 'Current smoker']}
                onChange={(value) => updatePatientForm('smokingStatus', value)}
              />
              <ChoiceField
                label="Immune Status"
                value={patientForm.immuneStatus}
                options={['Immunocompromised', 'Immunocompetent']}
                onChange={(value) => updatePatientForm('immuneStatus', value)}
              />
              <ChoiceField
                label="Pregnancy"
                value={patientForm.pregnancyStatus}
                options={['Pregnant', 'Not Pregnant', 'N/A']}
                onChange={(value) => updatePatientForm('pregnancyStatus', value)}
              />
              <Text style={styles.fieldLabel}>Lab Results</Text>
              <TextInput
                value={patientForm.labResults}
                onChangeText={(value) => updatePatientForm('labResults', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Lab results"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create patient"
                onPress={saveNewPatient}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Create Patient</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : route.name === 'edit' && routedPatient && patientForm ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
          >
            {infoMessage ? (
              <View style={styles.infoBanner}>
                <Text style={styles.infoBannerText}>{infoMessage}</Text>
              </View>
            ) : null}

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Patient Details</Text>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                value={patientForm.name}
                onChangeText={(value) => updatePatientForm('name', value)}
                style={styles.input}
                placeholder="Patient name"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                value={patientForm.email}
                onChangeText={(value) => updatePatientForm('email', value)}
                style={styles.input}
                placeholder="Patient email"
                placeholderTextColor={colors.searchPlaceholder}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Text style={styles.fieldLabel}>Age</Text>
              <TextInput
                value={patientForm.age}
                onChangeText={(value) => updatePatientForm('age', value)}
                keyboardType="numeric"
                style={styles.input}
                placeholder="Age"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <ChoiceField
                label="Sex"
                value={patientForm.sex}
                options={['Female', 'Male']}
                onChange={(value) => updatePatientForm('sex', value)}
              />
              <Text style={styles.fieldLabel}>Diagnosis</Text>
              <TextInput
                value={patientForm.diagnosis}
                onChangeText={(value) => updatePatientForm('diagnosis', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Primary diagnosis or condition"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Relevant Medical History</Text>
              <TextInput
                value={patientForm.relevantMedicalHistory}
                onChangeText={(value) => updatePatientForm('relevantMedicalHistory', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Relevant medical history"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Family Medical History</Text>
              <TextInput
                value={patientForm.familyMedicalHistory}
                onChangeText={(value) => updatePatientForm('familyMedicalHistory', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Family medical history"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Current Medications</Text>
              <TextInput
                value={patientForm.currentMedications}
                onChangeText={(value) => updatePatientForm('currentMedications', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Current medicines"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <ChoiceField
                label="Alcohol"
                value={patientForm.alcoholUse}
                options={['None', 'Social', 'Daily']}
                onChange={(value) => updatePatientForm('alcoholUse', value)}
              />
              <ChoiceField
                label="Smoking"
                value={patientForm.smokingStatus}
                options={['Never smoker', 'Former smoker', 'Current smoker']}
                onChange={(value) => updatePatientForm('smokingStatus', value)}
              />
              <ChoiceField
                label="Immune Status"
                value={patientForm.immuneStatus}
                options={['Immunocompromised', 'Immunocompetent']}
                onChange={(value) => updatePatientForm('immuneStatus', value)}
              />
              <ChoiceField
                label="Pregnancy"
                value={patientForm.pregnancyStatus}
                options={['Pregnant', 'Not Pregnant', 'N/A']}
                onChange={(value) => updatePatientForm('pregnancyStatus', value)}
              />
              <Text style={styles.fieldLabel}>Lab Results</Text>
              <TextInput
                value={patientForm.labResults}
                onChangeText={(value) => updatePatientForm('labResults', value)}
                style={[styles.textArea, styles.input]}
                multiline
                placeholder="Lab results"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save patient details"
                onPress={saveEditedPatient}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Save Patient Details</Text>
              </Pressable>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Past Visit Details</Text>
              {routedPatient.pastVisits.length === 0 ? (
                <Text style={styles.emptySectionText}>No previous visits logged.</Text>
              ) : (
                routedPatient.pastVisits.map((visit) => (
                  <Pressable
                    key={visit.id}
                    accessibilityRole="button"
                    accessibilityLabel={`View visit from ${visit.date}`}
                    onPress={() => openVisitDetails(routedPatient.id, visit.id)}
                    style={styles.visitRow}
                  >
                    <View style={styles.visitTopRow}>
                      <Text style={styles.visitDate}>{visit.date}</Text>
                      <Text style={styles.visitDiagnosis}>{visit.diagnosis}</Text>
                    </View>
                    <Text style={styles.visitSummary}>{visit.summary}</Text>
                    <Text style={styles.visitHint}>Tap to view or edit this visit</Text>
                  </Pressable>
                ))
              )}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add visit for this patient"
              onPress={() => openAddVisit(routedPatient.id)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Add Visit</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ask or refer a healthcare professional"
              onPress={() => openHcpReferral(routedPatient.id)}
              style={styles.secondaryButtonWide}
            >
              <Text style={styles.secondaryButtonWideText}>Ask/Refer an HCP</Text>
            </Pressable>
          </ScrollView>
        ) : route.name === 'visitDetails' && routedPatient && activeVisit ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Visit Summary</Text>
              <DetailRow label="Visit Date" value={activeVisit.date} />
              <DetailRow label="Diagnosis" value={activeVisit.diagnosis} />
              <DetailRow label="Notes" value={activeVisit.summary} multiline />
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Symptoms</Text>
              {activeVisit.symptoms.length === 0 ? (
                <Text style={styles.emptySectionText}>No symptoms recorded for this visit.</Text>
              ) : (
                activeVisit.symptoms.map((symptom) => (
                  <View key={symptom.id} style={styles.symptomCard}>
                    <View style={styles.symptomTop}>
                      <Text style={styles.symptomName}>{symptom.name}</Text>
                      <Text style={styles.symptomOnset}>{symptom.onset}</Text>
                    </View>
                    <Text style={styles.symptomMeta}>
                      {symptom.duration} · {symptom.frequency}
                    </Text>
                    <Text style={styles.symptomMeta}>Trigger: {symptom.trigger}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Current Intake Snapshot</Text>
              <DetailRow
                label="Current Medications"
                value={activeVisit.currentMedications}
                multiline
              />
              <DetailRow label="Alcohol" value={activeVisit.alcoholUse} />
              <DetailRow label="Smoking" value={activeVisit.smokingStatus} />
              <DetailRow label="Immune Status" value={activeVisit.immuneStatus} />
              <DetailRow label="Pregnancy" value={activeVisit.pregnancyStatus} />
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Labs Snapshot</Text>
              <DetailRow label="Lab Results" value={activeVisit.labResults} multiline />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit this visit"
              onPress={() => openAddVisit(routedPatient.id, activeVisit.id)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Edit This Visit</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a new visit"
              onPress={() => openAddVisit(routedPatient.id)}
              style={styles.secondaryButtonWide}
            >
              <Text style={styles.secondaryButtonWideText}>Add New Visit</Text>
            </Pressable>
          </ScrollView>
        ) : route.name === 'hcpList' && routedPatient ? (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.detailsContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
            >
              {referralSuccessMessage ? (
                <View style={styles.infoBanner}>
                  <Text style={styles.infoBannerText}>{referralSuccessMessage}</Text>
                </View>
              ) : null}

              <View style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>Recommended HCPs</Text>
                <View style={styles.inlineSearchBar}>
                  <SearchIcon color={colors.searchPlaceholder} size={18} />
                  <TextInput
                    value={hcpSearchQuery}
                    onChangeText={setHcpSearchQuery}
                    style={styles.inlineSearchInput}
                    placeholder={defaultSpecializationQuery || 'Search doctor name or specialization'}
                    placeholderTextColor={colors.searchPlaceholder}
                    onSubmitEditing={Keyboard.dismiss}
                  />
                </View>
                <Text style={styles.sectionHint}>Top 10 matching doctors</Text>

                {hcpSearchResults.map((doctor) => (
                  <Pressable
                    key={doctor.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open profile for ${doctor.name}`}
                    onPress={() => {
                      Keyboard.dismiss();
                      openDoctorProfile(routedPatient.id, doctor.id);
                    }}
                    style={styles.doctorCard}
                  >
                    <View style={styles.doctorCardHead}>
                      <Text style={styles.doctorName}>{doctor.name}</Text>
                      <Text style={styles.doctorDistance}>
                        {rankedHcps && rankedHcps.some((ranked) => ranked.id === doctor.id)
                          ? doctor.subspecialtyFocus ?? formatDistance(doctor.distanceKm)
                          : formatDistance(doctor.distanceKm)}
                      </Text>
                    </View>
                    <Text style={styles.doctorMeta}>{doctor.designation}</Text>
                    <Text style={styles.doctorMeta}>{doctor.specializations.join(' · ')}</Text>
                  </Pressable>
                ))}

                {hcpSearchResults.length === 0 ? (
                  <Text style={styles.emptySectionText}>No doctors match this search.</Text>
                ) : null}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : route.name === 'doctorProfile' && routedPatient && routedDoctorId ? (
          <View style={styles.flex}>
            {referralSuccessMessage ? (
              <View style={[styles.infoBanner, styles.infoBannerClear]}>
                <Text style={styles.infoBannerText}>{referralSuccessMessage}</Text>
              </View>
            ) : null}
            <DoctorProfileCard
              doctorKey={routedDoctorId}
              onOpenConsults={() => openDoctorChat(routedPatient.id, routedDoctorId)}
              onOpenDirectory={onOpenDirectory}
              onOpenReferrals={onOpenReferrals}
            />
          </View>
        ) : route.name === 'doctorChat' && routedPatient && routedDoctor ? (
          <View style={styles.flex}>
            {referralSuccessMessage ? (
              <View style={[styles.infoBanner, styles.chatInfoBanner]}>
                <Text style={styles.infoBannerText}>{referralSuccessMessage}</Text>
              </View>
            ) : null}
            <ChatThread
              messages={routedDoctorThread?.messages ?? []}
              onSend={sendDoctorMessage}
              currentUserId={CURRENT_DOCTOR_KEY}
              peerNameForTheirs={() => routedDoctor.name}
              placeholder={`Message ${routedDoctor.name.split(' ')[1] ?? 'doctor'}…`}
            />
          </View>
        ) : route.name === 'addVisit' && routedPatient && visitForm ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Visit Summary</Text>
              <Text style={styles.sectionHint}>Diagnosis and notes are optional.</Text>
              <Text style={styles.fieldLabel}>Diagnosis</Text>
              <TextInput
                value={visitForm.diagnosis}
                onChangeText={(value) => updateVisitForm('diagnosis', value)}
                style={styles.input}
                placeholder="Diagnosis"
                placeholderTextColor={colors.searchPlaceholder}
              />
              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                value={visitForm.notes}
                onChangeText={(value) => updateVisitForm('notes', value)}
                multiline
                style={[styles.textArea, styles.input]}
                placeholder="Notes"
                placeholderTextColor={colors.searchPlaceholder}
              />
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Symptoms</Text>
              <Text style={styles.sectionHint}>
                Add symptoms with duration, frequency, trigger, and onset.
              </Text>

              {visitForm.symptoms.length === 0 ? (
                <Text style={styles.emptySectionText}>
                  No symptoms added yet. Use Add Symptom to start this visit.
                </Text>
              ) : (
                visitForm.symptoms.map((symptom) => (
                  <View key={symptom.id} style={styles.symptomCard}>
                    <View style={styles.symptomTop}>
                      <Text style={styles.symptomName}>{symptom.name}</Text>
                      <Text style={styles.symptomOnset}>{symptom.onset}</Text>
                    </View>
                    <Text style={styles.symptomMeta}>
                      {symptom.duration} · {symptom.frequency}
                    </Text>
                    <Text style={styles.symptomMeta}>Trigger: {symptom.trigger}</Text>
                  </View>
                ))
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add symptom"
                onPress={() => setAddSymptomOpen(true)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>+ Add Symptom</Text>
              </Pressable>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Current Intake</Text>
              <Text style={styles.fieldLabel}>Current Medicines</Text>
              <TextInput
                value={visitForm.currentMedications}
                onChangeText={(value) => updateVisitForm('currentMedications', value)}
                multiline
                style={[styles.textArea, styles.input]}
                placeholder="List medicines currently being taken"
                placeholderTextColor={colors.searchPlaceholder}
              />

              <ChoiceField
                label="Alcohol"
                value={visitForm.alcoholUse}
                options={['None', 'Social', 'Daily']}
                onChange={(value) => updateVisitForm('alcoholUse', value)}
              />
              <ChoiceField
                label="Smoking"
                value={visitForm.smokingStatus}
                options={['Never smoker', 'Former smoker', 'Current smoker']}
                onChange={(value) => updateVisitForm('smokingStatus', value)}
              />
              <ChoiceField
                label="Immune Status"
                value={visitForm.immuneStatus}
                options={['Immunocompromised', 'Immunocompetent']}
                onChange={(value) => updateVisitForm('immuneStatus', value)}
              />
              <ChoiceField
                label="Pregnancy"
                value={visitForm.pregnancyStatus}
                options={['Pregnant', 'Not Pregnant', 'N/A']}
                onChange={(value) => updateVisitForm('pregnancyStatus', value)}
              />
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Labs</Text>
              <Text style={styles.fieldLabel}>Lab Results</Text>
              <TextInput
                value={visitForm.labResults}
                onChangeText={(value) => updateVisitForm('labResults', value)}
                multiline
                style={[styles.textArea, styles.input]}
                placeholder="Capture key lab values and findings"
                placeholderTextColor={colors.searchPlaceholder}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save visit"
              onPress={openVisitSavePrompt}
              style={[styles.primaryButton, visitSaveBusy && styles.primaryButtonDisabled]}
              disabled={visitSaveBusy}
            >
              <Text style={styles.primaryButtonText}>
                {route.visitId ? 'Save Visit Changes' : 'Save Visit'}
              </Text>
            </Pressable>
          </ScrollView>
        ) : (
          <View style={styles.centeredState}>
            <Text style={styles.emptyStateTitle}>Patient not found</Text>
          </View>
        )}
      </View>

      {selectedPatient ? (
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetOverlay} onPress={() => setSelectedPatientId(null)} />
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{selectedPatient.name}</Text>
              <Text style={styles.sheetSubtitle}>
                Age {selectedPatient.age} ·{' '}
                {suitableMode
                  ? `${selectedPatient.diagnosis} Cohort`
                  : selectedPatient.diagnosis}
              </Text>
              <Text style={styles.sheetSubtitle}>
                {displayPatientEmail(selectedPatient)}
              </Text>
            </View>
            {sheetActions.map((action) => {
              const Icon = action.Icon;
              return (
                <Pressable
                  key={action.key}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => handleAction(action.key)}
                  style={styles.sheetAction}
                >
                  <View style={styles.sheetActionInner}>
                    <Icon color={colors.textMuted} size={18} />
                    <Text style={styles.sheetActionText}>{action.label}</Text>
                  </View>
                </Pressable>
              );
            })}
            {emailOpen ? (
              <View style={styles.emailBox}>
                <TextInput
                  value={emailPrompt}
                  onChangeText={setEmailPrompt}
                  style={styles.emailInput}
                  placeholder="What should the email say?"
                  placeholderTextColor={colors.searchPlaceholder}
                  multiline
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send email"
                  disabled={emailBusy}
                  onPress={() => {
                    const prompt = emailPrompt.trim();
                    if (!prompt || !selectedPatient) return;
                    setEmailBusy(true);
                    sendPromptEmail(selectedPatient.id, prompt)
                      .then((result) => {
                        setEmailOpen(false);
                        setSelectedPatientId(null);
                        setInfoMessage(
                          result.source === 'gemini'
                            ? `Email sent to the clinic inbox. Subject: ${result.subject}`
                            : `Email sent with the doctor's note. Subject: ${result.subject}`,
                        );
                      })
                      .catch(() => setInfoMessage('Could not send that email.'))
                      .finally(() => setEmailBusy(false));
                  }}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {emailBusy ? 'Sending...' : 'Write and send email'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {pdfOpen ? (
              <View style={styles.pdfBox}>
                {pdfPreparing ? (
                  <View style={styles.pdfPreparingRow}>
                    <ActivityIndicator size="small" color={colors.accentPurple} />
                    <Text style={styles.pdfStatusText}>
                      Generating summarized PDF with patient details and past-visit summary...
                    </Text>
                  </View>
                ) : pdfReady ? (
                  <>
                    <Text style={styles.pdfStatusText}>
                      PDF is ready. Past visits were summarized with{' '}
                      {pdfSummarySource === 'gemini' ? 'Gemini' : 'the local fallback'}.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Download summarized PDF"
                      onPress={() => openRecordPdf(selectedPatient.id)}
                      style={styles.secondaryButtonWide}
                      disabled={pdfSendBusy}
                    >
                      <Text style={styles.secondaryButtonWideText}>Download PDF</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Send summarized PDF to patient"
                      onPress={() => {
                        setPdfSendBusy(true);
                        sendSummarizedRecordPdf(selectedPatient.id)
                          .then((result) => {
                            setPdfOpen(false);
                            setSelectedPatientId(null);
                            setInfoMessage(`Summarized PDF sent to patient (${result.recipient}).`);
                          })
                          .catch(() => setInfoMessage('Could not send summarized PDF to the patient.'))
                          .finally(() => setPdfSendBusy(false));
                      }}
                      style={[styles.primaryButton, pdfSendBusy && styles.primaryButtonDisabled]}
                      disabled={pdfSendBusy}
                    >
                      <Text style={styles.primaryButtonText}>
                        {pdfSendBusy ? 'Sending...' : 'Send to Patient'}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.pdfStatusText}>Could not prepare the summarized PDF.</Text>
                )}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {similarAnalysis ? (
        <View style={styles.sheetRoot}>
          <Pressable
            style={styles.sheetOverlay}
            onPress={() => {
              setSelectedSimilarMatchId(null);
              setSimilarAnalysis(null);
            }}
          />
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            {selectedSimilarMatch ? (
              <>
                <View style={styles.sheetModalHeader}>
                  <Pressable
                    onPress={() => setSelectedSimilarMatchId(null)}
                    style={styles.sheetBackBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Back to cohort list"
                  >
                    <ChevronLeftIcon color={colors.textPrimary} size={20} />
                  </Pressable>
                  <Text style={styles.sheetTitle}>Cohort Detail</Text>
                  <Pressable
                    onPress={() => {
                      setSelectedSimilarMatchId(null);
                      setSimilarAnalysis(null);
                    }}
                    style={styles.sheetCloseBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Close cohort analysis"
                  >
                    <CloseIcon color={colors.textPrimary} size={18} />
                  </Pressable>
                </View>
                <ScrollView style={styles.similarList}>
                  <Text style={styles.similarDetailDiagnosis}>
                    {selectedSimilarMatch.details.diagnosis_label}
                  </Text>
                  <Text style={styles.similarDetailPrescription}>
                    {selectedSimilarMatch.details.prescription_label}
                  </Text>
                  <Text style={styles.similarConfidence}>
                    {selectedSimilarMatch.confidence_percent}% clinical match
                  </Text>
                  <Text style={styles.similarMeta}>{selectedSimilarMatch.rationale}</Text>
                  <Text style={styles.similarMeta}>
                    Age cohort {selectedSimilarMatch.details.age_group} ·{' '}
                    {selectedSimilarMatch.details.sex_label}
                  </Text>

                  <Text style={styles.similarSectionTitle}>Symptoms</Text>
                  {selectedSimilarMatch.details.symptoms.map((symptom, index) => (
                    <View key={`${selectedSimilarMatch.match_id}-sym-${index}`} style={styles.similarSymptomCard}>
                      <View style={styles.similarSymptomTop}>
                        <Text style={styles.similarSymptomName}>{symptom.name}</Text>
                        <Text style={styles.similarSymptomOnset}>{symptom.onset}</Text>
                      </View>
                      <Text style={styles.similarMeta}>
                        {symptom.duration} · {symptom.frequency}
                      </Text>
                      <Text style={styles.similarMeta}>Trigger: {symptom.trigger}</Text>
                    </View>
                  ))}

                  <Text style={styles.similarSectionTitle}>Anonymized Context</Text>
                  <Text style={styles.similarMeta}>
                    Relevant history: {selectedSimilarMatch.details.relevant_medical_history}
                  </Text>
                  <Text style={styles.similarMeta}>
                    Family history: {selectedSimilarMatch.details.family_medical_history}
                  </Text>
                  <Text style={styles.similarMeta}>
                    Current medications: {selectedSimilarMatch.details.current_medications}
                  </Text>
                  <Text style={styles.similarMeta}>Alcohol use: {selectedSimilarMatch.details.alcohol_use}</Text>
                  <Text style={styles.similarMeta}>Smoking status: {selectedSimilarMatch.details.smoking_status}</Text>
                  <Text style={styles.similarMeta}>Immune status: {selectedSimilarMatch.details.immune_status}</Text>
                  <Text style={styles.similarMeta}>
                    Pregnancy status: {selectedSimilarMatch.details.pregnancy_status}
                  </Text>
                  <Text style={styles.similarMeta}>Lab results: {selectedSimilarMatch.details.lab_results}</Text>
                </ScrollView>
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>{similarAnalysis.title}</Text>
                <Text style={styles.sheetSubtitle}>{similarAnalysis.explanation}</Text>
                <ScrollView style={styles.similarList}>
                  {similarLoading ? (
                    <Text style={styles.emptySectionText}>Finding cohort matches...</Text>
                  ) : similarAnalysis.matches.length === 0 ? (
                    <Text style={styles.emptySectionText}>No cohort matches available yet.</Text>
                  ) : (
                    similarAnalysis.matches.slice(0, 10).map((match: SimilarCohortMatch) => (
                      <Pressable
                        key={match.match_id}
                        onPress={() => setSelectedSimilarMatchId(match.match_id)}
                        style={styles.similarRow}
                        accessibilityRole="button"
                        accessibilityLabel={`Open cohort detail with ${match.confidence_percent}% match`}
                      >
                        <View style={styles.similarRowTop}>
                          <Text style={styles.similarTitle}>
                            Age {match.preview.age_group} · {match.details.sex_label}
                          </Text>
                          <Text style={styles.similarConfidence}>
                            {match.confidence_percent}% match
                          </Text>
                        </View>
                        <Text style={styles.similarDetailDiagnosis}>{match.preview.diagnosis_label}</Text>
                        <Text style={styles.similarMeta}>
                          Symptoms: {match.preview.symptom_labels.join(' · ') || 'Not specified'}
                        </Text>
                        <Text style={styles.similarMeta}>{match.rationale}</Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      ) : null}

      {confirmReferralOpen &&
      route.name === 'doctorProfile' &&
      routedDoctor &&
      routedPatient ? (
        <View pointerEvents={boxNonePointerEvents} style={styles.confirmRoot}>
          <Pressable
            style={styles.confirmOverlay}
            onPress={() => setConfirmReferralOpen(false)}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Confirm Referral</Text>
            <Text style={styles.confirmText}>
              Refer {routedPatient.name} to {routedDoctor.name}? This sends the referral email to
              the patient and immediately shares medical history with the doctor.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable onPress={() => setConfirmReferralOpen(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmDoctorReferral} style={styles.referBtn}>
                <Text style={styles.referBtnText}>Refer</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {followUpPromptOpen && route.name === 'addVisit' ? (
        <View pointerEvents={boxNonePointerEvents} style={styles.followUpRoot}>
          <Pressable
            style={styles.confirmOverlay}
            onPress={() => {
              if (visitSaveBusy) return;
              setFollowUpPromptOpen(false);
            }}
          />
          <View style={styles.followUpCard}>
            <Text style={styles.confirmTitle}>Send follow-up emails?</Text>
            <Text style={styles.confirmText}>
              Do you want to send follow-up emails after this visit is saved?
            </Text>

            <Text style={styles.fieldLabel}>Frequency Slider</Text>
            <Text style={styles.followUpFrequencyValue}>{selectedFollowUpFrequency}</Text>
            <View style={styles.followUpSliderTrack}>
              <View style={[styles.followUpSliderFill, { width: `${followUpProgressPercent}%` }]} />
              <View style={styles.followUpSliderSteps}>
                {FOLLOW_UP_FREQUENCY_OPTIONS.map((option, index) => {
                  const active = index === followUpFrequencyIndex;
                  const passed = index < followUpFrequencyIndex;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityLabel={`Set follow-up frequency to ${option}`}
                      onPress={() => setFollowUpFrequencyIndex(index)}
                      style={styles.followUpSliderStep}
                    >
                      <View
                        style={[
                          styles.followUpSliderDot,
                          (active || passed) && styles.followUpSliderDotPassed,
                          active && styles.followUpSliderDotActive,
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.followUpSliderLegend}>
              <Text style={styles.followUpSliderLegendText}>1 day</Text>
              <Text style={styles.followUpSliderLegendText}>4 weeks</Text>
            </View>
            <View style={styles.followUpOptionGrid}>
              {FOLLOW_UP_FREQUENCY_OPTIONS.map((option, index) => {
                const active = index === followUpFrequencyIndex;
                return (
                  <Pressable
                    key={`pill-${option}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setFollowUpFrequencyIndex(index)}
                    style={[styles.followUpOptionPill, active && styles.followUpOptionPillActive]}
                  >
                    <Text
                      style={[styles.followUpOptionPillText, active && styles.followUpOptionPillTextActive]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>Follow-up Topic</Text>
            <TextInput
              value={followUpTopic}
              onChangeText={setFollowUpTopic}
              multiline
              style={[styles.textArea, styles.input, styles.followUpTextArea]}
              placeholder={FOLLOW_UP_PROMPT_PLACEHOLDER}
              placeholderTextColor={colors.searchPlaceholder}
            />

            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save visit without follow-up emails"
                onPress={() => saveVisit(false)}
                style={[styles.cancelBtn, visitSaveBusy && styles.primaryButtonDisabled]}
                disabled={visitSaveBusy}
              >
                <Text style={styles.cancelBtnText}>
                  {visitSaveBusy ? 'Saving...' : 'No, just save visit'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save visit and schedule follow-up emails"
                onPress={() => saveVisit(true)}
                style={[styles.referBtn, visitSaveBusy && styles.primaryButtonDisabled]}
                disabled={visitSaveBusy}
              >
                <Text style={styles.referBtnText}>Save + follow-up emails</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {formalReferralPatient && currentDoctor ? (
        <ReferralWorkspace
          currentDoctor={currentDoctor}
          initialPatient={formalReferralPatient}
          onClose={() => setFormalReferralPatient(null)}
          onMessageDoctor={(doctor) => {
            const patientId = formalReferralPatient.id;
            setFormalReferralPatient(null);
            openDoctorChat(patientId, doctor.id);
          }}
          onSaved={() => {
            setReferralSuccessMessage(
              `Referral sent for ${formalReferralPatient.name}. Handoff packet shared after the receiving clinician accepts.`,
            );
            setInfoMessage(
              `Referral sent for ${formalReferralPatient.name}. Handoff packet shared after the receiving clinician accepts.`,
            );
          }}
        />
      ) : null}

      {addSymptomOpen ? (
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetOverlay} onPress={() => setAddSymptomOpen(false)} />
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetModalHeader}>
              <Text style={styles.sheetTitle}>Add Symptom</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close symptom modal"
                onPress={() => setAddSymptomOpen(false)}
                style={styles.closeCircle}
              >
                <CloseIcon color={colors.textMuted} size={18} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Symptom</Text>
            <TextInput
              value={symptomDraft.name}
              onChangeText={(value) =>
                setSymptomDraft((current) => ({ ...current, name: value }))
              }
              style={styles.input}
              placeholder="e.g., Cough"
              placeholderTextColor={colors.searchPlaceholder}
            />

            <Text style={styles.fieldLabel}>How long have you had it?</Text>
            <TextInput
              value={symptomDraft.duration}
              onChangeText={(value) =>
                setSymptomDraft((current) => ({ ...current, duration: value }))
              }
              style={styles.input}
              placeholder="e.g., 8 weeks"
              placeholderTextColor={colors.searchPlaceholder}
            />

            <Text style={styles.fieldLabel}>Frequency</Text>
            <TextInput
              value={symptomDraft.frequency}
              onChangeText={(value) =>
                setSymptomDraft((current) => ({ ...current, frequency: value }))
              }
              style={styles.input}
              placeholder="e.g., Daily"
              placeholderTextColor={colors.searchPlaceholder}
            />

            <Text style={styles.fieldLabel}>Factor that increases symptom</Text>
            <TextInput
              value={symptomDraft.trigger}
              onChangeText={(value) =>
                setSymptomDraft((current) => ({ ...current, trigger: value }))
              }
              style={styles.input}
              placeholder="e.g., Lying down"
              placeholderTextColor={colors.searchPlaceholder}
            />

            <ChoiceField
              label="Onset"
              value={symptomDraft.onset}
              options={['Gradual', 'Sudden']}
              onChange={(value) =>
                setSymptomDraft((current) => ({ ...current, onset: value }))
              }
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save symptom"
              onPress={addSymptom}
              style={[
                styles.primaryButton,
                !symptomDraft.name.trim() && styles.primaryButtonDisabled,
              ]}
              disabled={!symptomDraft.name.trim()}
            >
              <Text style={styles.primaryButtonText}>Save Symptom</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, multiline && styles.detailValueMultiline]}>
        {value}
      </Text>
    </View>
  );
}

function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choiceField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map((option) => {
          const active = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(option)}
              style={[styles.choicePill, active && styles.choicePillActive]}
            >
              <Text style={[styles.choicePillText, active && styles.choicePillTextActive]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function formatMetricValue(value: number, unit: PerformancePoint['unit']) {
  const normalized =
    Math.abs(value) >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  if (unit === '%') return `${normalized}%`;
  if (unit === 'kg') return `${normalized} kg`;
  if (unit === 'hours/day') return `${normalized} h/day`;
  if (unit === 'months') return `${normalized} mo`;
  if (unit === 'points') return `${normalized} pts`;
  return normalized;
}

function PerformanceComparisonChart({
  points,
  treatmentLabel,
  comparatorLabel,
  compact = false,
}: {
  points: PerformancePoint[];
  treatmentLabel: string;
  comparatorLabel: string;
  compact?: boolean;
}) {
  const peak = Math.max(
    ...points.flatMap((point) => [Math.abs(point.treatmentValue), Math.abs(point.comparatorValue)]),
    1,
  );

  return (
    <View style={styles.performanceChartWrap}>
      {points.map((point) => (
        <View key={point.label} style={[styles.performanceRow, compact && styles.performanceRowCompact]}>
          <View style={styles.performanceRowHeader}>
            <Text style={styles.performanceRowLabel}>{point.label}</Text>
            <Text style={styles.performanceRowHint}>
              {point.betterWhen === 'lower' ? 'Lower is better' : 'Higher is better'}
            </Text>
          </View>

          <View style={styles.performanceBarPair}>
            <Text style={styles.performanceSeriesLabel}>{treatmentLabel}</Text>
            <View style={styles.performanceTrack}>
              <View
                style={[
                  styles.performanceFillTreatment,
                  { width: `${(Math.abs(point.treatmentValue) / peak) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.performanceValue}>
              {formatMetricValue(point.treatmentValue, point.unit)}
            </Text>
          </View>

          <View style={styles.performanceBarPair}>
            <Text style={styles.performanceSeriesLabel}>{comparatorLabel}</Text>
            <View style={styles.performanceTrack}>
              <View
                style={[
                  styles.performanceFillComparator,
                  { width: `${(Math.abs(point.comparatorValue) / peak) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.performanceValue}>
              {formatMetricValue(point.comparatorValue, point.unit)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerSuitable: {
    backgroundColor: 'rgba(90, 200, 250, 0.22)',
    borderBottomColor: colors.skyBlueBorder,
    borderBottomWidth: 2,
    gap: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
    paddingVertical: 4,
    paddingRight: 8,
    minWidth: 0,
  },
  headerTitles: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  headerTitleSuitable: {
    color: colors.skyBlue,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 1,
  },
  headerSubtitleSuitable: {
    color: 'rgba(90, 200, 250, 0.95)',
  },
  notifyAllBtn: {
    backgroundColor: colors.skyBlue,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: 118,
  },
  notifyAllBtnPressed: {
    opacity: 0.85,
  },
  notifyAllBtnText: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 14,
  },
  whatsNewBtn: {
    width: 104,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsNewBtnPressed: {
    opacity: 0.78,
  },
  whatsNewBtnImage: {
    width: '100%',
    height: '100%',
  },
  body: {
    flex: 1,
  },
  searchBar: {
    marginTop: 14,
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F2F3F7',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 96,
    gap: 12,
  },
  listContentWithSearchLauncher: {
    paddingTop: 74,
  },
  listContentWithInlineSearch: {
    paddingTop: 98,
  },
  searchLayerRoot: {
    ...StyleSheet.absoluteFill,
    zIndex: 120,
  },
  searchInlineContainer: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 130,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInlineContainerExpanded: {
    right: 16,
  },
  searchLauncherBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    zIndex: 130,
  },
  searchLauncherBtnPressed: {
    opacity: 0.88,
  },
  addPatientFab: {
    position: 'absolute',
    right: 18,
    bottom: 26,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accentPurple,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 132,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  addPatientFabPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  addPatientFabText: {
    color: colors.white,
    fontSize: 30,
    lineHeight: 32,
    fontWeight: '700',
    marginTop: -2,
  },
  searchInlineBar: {
    flex: 1,
    minHeight: 46,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: '#F2F3F7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInlineInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  searchInlineCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.24)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 121,
  },
  searchOverlayDismiss: {
    ...StyleSheet.absoluteFill,
  },
  searchMenuAnchor: {
    position: 'absolute',
    top: 16,
    left: 72,
    zIndex: 125,
    gap: 8,
  },
  searchModePillWrap: {
    minWidth: 122,
  },
  searchModePillWrapSecond: {
    minWidth: 122,
    marginTop: 8,
  },
  searchModePill: {
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    backgroundColor: 'rgba(15, 18, 34, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  searchModePillActive: {
    backgroundColor: 'rgba(123,97,255,0.94)',
    borderColor: '#D7CBFF',
  },
  searchModePillText: {
    color: '#E8EBFF',
    fontSize: 13,
    fontWeight: '700',
  },
  searchModePillTextActive: {
    color: colors.white,
  },
  searchPanel: {
    position: 'absolute',
    top: 66,
    left: 12,
    right: 12,
    bottom: 88,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(196,181,253,0.45)',
    backgroundColor: 'rgba(9, 12, 24, 0.95)',
    zIndex: 126,
    padding: 12,
    gap: 10,
  },
  searchPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchPanelIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  searchPanelTitleWrap: {
    flex: 1,
  },
  searchPanelTitle: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '800',
  },
  searchPanelSubtitle: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
  searchPanelInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 10,
    minHeight: 44,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: '#F2F3F7',
  },
  searchPanelInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  searchPanelFilterBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.28)',
    backgroundColor: '#FFFFFF',
  },
  searchPanelFilterBtnActive: {
    borderColor: 'rgba(123,97,255,0.7)',
    backgroundColor: 'rgba(123,97,255,0.1)',
  },
  searchFilterCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(196,181,253,0.42)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: 10,
    gap: 8,
  },
  searchFilterCardInline: {
    position: 'absolute',
    top: 68,
    left: 16,
    right: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(196,181,253,0.42)',
    backgroundColor: 'rgba(20,24,44,0.96)',
    padding: 10,
    gap: 8,
    zIndex: 128,
  },
  searchFilterTitle: {
    color: '#ECE8FF',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchFilterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchFilterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchFilterChipActive: {
    borderColor: '#D7CBFF',
    backgroundColor: 'rgba(123,97,255,0.55)',
  },
  searchFilterChipText: {
    color: '#F3F5FF',
    fontSize: 12,
    fontWeight: '700',
  },
  searchFilterChipTextActive: {
    color: colors.white,
  },
  searchFilterInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: colors.textPrimary,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'web' ? 9 : 8,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  searchFilterClearBtn: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(123,97,255,0.22)',
  },
  searchFilterClearText: {
    color: '#E8DDFF',
    fontSize: 12,
    fontWeight: '700',
  },
  searchPanelResults: {
    paddingBottom: 14,
    gap: 10,
  },
  searchEmptyState: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 6,
  },
  searchEmptyStateInline: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
  },
  searchEmptyStateTitle: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
  searchEmptyStateText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12.5,
    textAlign: 'center',
  },
  searchPatientResultCard: {
    borderRadius: 14,
    backgroundColor: '#F4F5F9',
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.14)',
    padding: 11,
    gap: 6,
  },
  searchPatientResultTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  searchPatientResultName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  searchPatientResultAge: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  searchResultMeta: {
    color: colors.textSecondary,
    fontSize: 12.5,
  },
  drugSectionHeader: {
    marginTop: 6,
    marginBottom: 2,
    gap: 3,
  },
  drugSectionHeaderTitle: {
    color: '#DED4FF',
    fontSize: 12.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  drugSectionHeaderText: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 11.5,
  },
  drugResultCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(196,181,253,0.35)',
    backgroundColor: 'rgba(255,255,255,0.95)',
    overflow: 'hidden',
  },
  drugResultImage: {
    width: '100%',
    height: 148,
    backgroundColor: '#D8DCE6',
  },
  drugResultBody: {
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 5,
  },
  drugResultLinksWrap: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  drugResultName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  drugResultCompany: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
  },
  drugResultSummary: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  drugResultSalts: {
    color: '#2A3554',
    fontSize: 12.5,
    fontWeight: '600',
  },
  drugResultLinks: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  drugFindPatientsButton: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: 'rgba(58,122,254,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(58,122,254,0.38)',
  },
  drugFindPatientsButtonText: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
  },
  drugWebsiteButton: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: 'rgba(123,97,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(123,97,255,0.35)',
  },
  drugWebsiteButtonText: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
  },
  drugDetailRoot: {
    ...StyleSheet.absoluteFill,
    zIndex: 130,
    justifyContent: 'flex-end',
  },
  drugDetailDismiss: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  drugDetailCard: {
    maxHeight: '82%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: colors.cardBg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(196,181,253,0.28)',
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 16,
  },
  drugDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  drugDetailHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  drugDetailKicker: {
    color: colors.accentPurple,
    fontSize: 11.5,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  drugDetailTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '800',
  },
  drugDetailContent: {
    paddingTop: 8,
    paddingBottom: 8,
    gap: 10,
  },
  drugDetailImage: {
    width: '100%',
    height: 188,
    borderRadius: 12,
    backgroundColor: '#D8DCE6',
  },
  drugDetailCompany: {
    color: colors.accentPurple,
    fontSize: 13,
    fontWeight: '700',
  },
  drugDetailSummary: {
    color: colors.textSecondary,
    fontSize: 13.5,
    lineHeight: 19,
  },
  drugDetailSection: {
    borderRadius: 12,
    backgroundColor: '#F6F7FA',
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.18)',
    padding: 10,
    gap: 5,
  },
  drugDetailSectionTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  drugDetailText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },
  whatsNewContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 104,
    gap: 12,
  },
  insightFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  insightFilterPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  insightFilterPillActive: {
    backgroundColor: 'rgba(123,97,255,0.25)',
    borderColor: '#C4B5FD',
  },
  insightFilterText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  insightFilterTextActive: {
    color: '#E8DDFF',
  },
  insightCard: {
    borderRadius: 16,
    backgroundColor: colors.cardBg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(123,97,255,0.26)',
    flexDirection: 'row',
  },
  insightAccent: {
    width: 6,
  },
  insightMain: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  insightTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  insightCategory: {
    color: colors.accentPurple,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  insightDate: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  insightName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  insightHeadline: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  insightHook: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  insightPlainLanguage: {
    color: '#3E4460',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '500',
  },
  chartCaption: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  insightFooter: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  insightHint: {
    color: colors.textMuted,
    fontSize: 11,
    flex: 1,
  },
  insightCta: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
  },
  insightDetailHero: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: 'rgba(123,97,255,0.25)',
    gap: 8,
  },
  insightDetailChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: 'rgba(123,97,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  insightDetailChipText: {
    color: colors.accentPurple,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.35,
  },
  insightDetailName: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  insightDetailHeadline: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  insightDetailSummary: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  insightDetailPlainLanguage: {
    color: '#2B3250',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },
  insightDetailHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  insightSectionCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.14)',
  },
  trialBlock: {
    gap: 8,
  },
  trialEyebrow: {
    color: colors.skyBlue,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  trialCard: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.skyBlueBorder,
  },
  trialAccent: {
    width: 5,
    backgroundColor: colors.trialOrange,
  },
  trialBody: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
  },
  trialTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  trialMeta: {
    color: colors.trialOrange,
    fontSize: 13,
    fontWeight: '600',
  },
  cohortHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  cohortTitle: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '800',
    flexShrink: 1,
  },
  cohortLegend: {
    color: colors.matchRed,
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
    maxWidth: 140,
  },
  focusBanner: {
    borderRadius: 12,
    backgroundColor: 'rgba(123,97,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(196,181,253,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  focusBannerEyebrow: {
    color: '#E8DDFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  focusBannerText: {
    marginTop: 2,
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  infoBanner: {
    backgroundColor: colors.skyBlueSoft,
    borderColor: colors.skyBlueBorder,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  infoBannerClear: {
    marginBottom: 12,
    zIndex: 5,
  },
  infoBannerText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  patientCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(90,96,112,0.12)',
  },
  patientCardMatch: {
    borderColor: colors.matchRed,
    backgroundColor: colors.matchRedSoft,
  },
  patientCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  patientCardHeadRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  patientName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  patientNameMatch: {
    color: colors.textPrimary,
  },
  patientEmail: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  patientAge: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  matchBadge: {
    backgroundColor: colors.matchRedSoft,
    borderWidth: 1,
    borderColor: colors.matchRed,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  matchBadgeText: {
    color: colors.matchRed,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  symptomsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  symptomPill: {
    backgroundColor: '#F2F3F7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  symptomPillMatch: {
    backgroundColor: 'rgba(229, 57, 53, 0.08)',
  },
  symptomPillText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  symptomPillTextMatch: {
    color: colors.textSecondary,
  },
  metaText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  detailsContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 108,
    gap: 12,
  },
  sectionCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    padding: 14,
  },
  profileHeroCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 88,
    paddingBottom: 16,
    position: 'relative',
  },
  profileAvatarWrap: {
    position: 'absolute',
    top: -64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  profileHeroName: {
    color: colors.textPrimary,
    fontSize: 40 / 2,
    fontWeight: '800',
    textAlign: 'center',
  },
  profileHeroMeta: {
    color: colors.accentPurple,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  profileDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(90,96,112,0.22)',
    marginTop: 14,
    marginBottom: 12,
  },
  profileSectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  profileDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 6,
  },
  profileAddressLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 10,
  },
  profileAddressValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  profileDistanceNote: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  profileActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  profileActionPrimary: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#4A36A8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileActionPrimaryText: {
    color: colors.white,
    fontSize: 18 / 1.25,
    fontWeight: '700',
  },
  profileActionSecondary: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#5C8A90',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileActionSecondaryText: {
    color: colors.white,
    fontSize: 18 / 1.25,
    fontWeight: '700',
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionHint: {
    marginTop: 6,
    color: colors.textMuted,
    fontSize: 13,
  },
  inlineSearchBar: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F2F3F7',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.18)',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 8,
  },
  inlineSearchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  detailRow: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(90,96,112,0.22)',
    paddingTop: 10,
    gap: 4,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  detailValueMultiline: {
    lineHeight: 19,
  },
  emptySectionText: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 14,
  },
  visitRow: {
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#F6F7FA',
    padding: 10,
    gap: 6,
  },
  visitTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  visitDate: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  visitDiagnosis: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
  visitSummary: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  visitHint: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: colors.accentPurple,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(123,97,255,0.35)',
    backgroundColor: 'rgba(123,97,255,0.08)',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.accentPurple,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButtonWide: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(123,97,255,0.35)',
    backgroundColor: 'rgba(123,97,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16,
  },
  secondaryButtonWideText: {
    color: colors.accentPurple,
    fontSize: 15,
    fontWeight: '700',
  },
  doctorCard: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#F6F7FA',
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  doctorCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  doctorName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  doctorDistance: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  doctorMeta: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  chatInfoBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  symptomCard: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#F6F7FA',
    padding: 10,
    gap: 4,
  },
  symptomTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  symptomName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  symptomOnset: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '700',
  },
  symptomMeta: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  performanceChartWrap: {
    marginTop: 10,
    gap: 12,
  },
  performanceRow: {
    borderRadius: 12,
    backgroundColor: '#F6F7FA',
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7,
  },
  performanceRowCompact: {
    gap: 6,
  },
  performanceRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  performanceRowLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  performanceRowHint: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  performanceBarPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  performanceSeriesLabel: {
    width: 110,
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  performanceTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(123,97,255,0.1)',
    overflow: 'hidden',
  },
  performanceFillTreatment: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.accentPurple,
  },
  performanceFillComparator: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#7A8AA3',
  },
  performanceValue: {
    width: 62,
    textAlign: 'right',
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  bulletRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginTop: 6,
    backgroundColor: colors.accentPurple,
  },
  bulletText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  evidenceCard: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: '#F6F7FA',
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 4,
  },
  evidenceSource: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  evidenceResult: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  sourceLinkRow: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.2)',
    backgroundColor: '#F6F7FA',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 4,
  },
  sourceLinkTitle: {
    color: colors.accentPurple,
    fontSize: 13,
    fontWeight: '700',
  },
  sourceLinkUrl: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  sideEffectWrap: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sideEffectPill: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: 'rgba(90, 200, 250, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(90, 200, 250, 0.42)',
  },
  sideEffectText: {
    color: '#2A667A',
    fontSize: 12,
    fontWeight: '700',
  },
  fieldLabel: {
    marginTop: 10,
    marginBottom: 6,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    backgroundColor: '#F2F3F7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.18)',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 9,
    fontSize: 14,
    color: colors.textPrimary,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  textArea: {
    minHeight: 82,
    textAlignVertical: 'top',
  },
  choiceField: {
    marginTop: 2,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choicePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.24)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  choicePillActive: {
    backgroundColor: 'rgba(123,97,255,0.12)',
    borderColor: 'rgba(123,97,255,0.4)',
  },
  choicePillText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  choicePillTextActive: {
    color: colors.accentPurple,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyStateTitle: {
    color: colors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  sheetRoot: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 80,
  },
  sheetOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheetCard: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 18,
    maxHeight: '85%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#D1D4DD',
    marginBottom: 12,
  },
  sheetHeader: {
    marginBottom: 10,
    gap: 2,
  },
  sheetTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  sheetSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
  },
  sheetAction: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.2)',
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 8,
    backgroundColor: colors.white,
  },
  sheetActionPrimary: {
    backgroundColor: colors.skyBlueSoft,
    borderColor: colors.skyBlueBorder,
  },
  sheetActionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sheetActionIconSpacer: {
    width: 18,
    height: 18,
  },
  sheetActionText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  sheetActionTextPrimary: {
    color: colors.skyBlue,
    fontWeight: '700',
  },
  sheetModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  sheetBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(138, 144, 160, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(138, 144, 160, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(138, 144, 160, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmRoot: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 90,
  },
  followUpRoot: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 95,
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  confirmCard: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
  },
  confirmTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
  },
  confirmText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  confirmActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  cancelBtnText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  referBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPurple,
  },
  referBtnText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  followUpCard: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    maxHeight: '85%',
  },
  followUpFrequencyValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },
  followUpSliderTrack: {
    position: 'relative',
    height: 22,
    justifyContent: 'center',
    marginBottom: 6,
  },
  followUpSliderFill: {
    position: 'absolute',
    left: 0,
    top: 9,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.accentPurple,
  },
  followUpSliderSteps: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
  },
  followUpSliderStep: {
    flex: 1,
    alignItems: 'center',
  },
  followUpSliderDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(90,96,112,0.35)',
    backgroundColor: '#fff',
  },
  followUpSliderDotPassed: {
    borderColor: colors.accentPurple,
    backgroundColor: 'rgba(123,97,255,0.16)',
  },
  followUpSliderDotActive: {
    backgroundColor: colors.accentPurple,
  },
  followUpSliderLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  followUpSliderLegendText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  followUpOptionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  followUpOptionPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.24)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  followUpOptionPillActive: {
    backgroundColor: 'rgba(123,97,255,0.12)',
    borderColor: 'rgba(123,97,255,0.42)',
  },
  followUpOptionPillText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  followUpOptionPillTextActive: {
    color: colors.accentPurple,
    fontWeight: '700',
  },
  followUpTextArea: {
    minHeight: 96,
  },
  emailBox: {
    marginTop: 12,
    gap: 10,
  },
  pdfBox: {
    marginTop: 12,
    gap: 10,
  },
  pdfPreparingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pdfStatusText: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  emailInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.22)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
    backgroundColor: '#fff',
  },
  similarList: {
    maxHeight: 360,
    marginTop: 8,
  },
  similarRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(90,96,112,0.12)',
  },
  similarRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  similarTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  similarConfidence: {
    color: colors.accentPurple,
    fontSize: 12,
    fontWeight: '800',
  },
  similarDetailDiagnosis: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 4,
  },
  similarDetailPrescription: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 8,
  },
  similarSectionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 6,
  },
  similarSymptomCard: {
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.18)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  similarSymptomTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  similarSymptomName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  similarSymptomOnset: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  similarMeta: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
});
