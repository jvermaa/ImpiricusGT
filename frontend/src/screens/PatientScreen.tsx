import React, { useEffect, useMemo, useState } from 'react';
import {
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  loadCurrentDoctor,
  loadMyPatients,
  loadConsultDirectory,
  loadRankedDoctors,
  loadSimilarCases,
  loadThreadMessages,
  openConsultThread,
  recordPdfUrl,
  sendConsultMessage,
  sendPromptEmail,
  type SimilarCase,
} from '../api/clinic';
import { createFormalReferral } from '../api/referrals';
import { CURRENT_DOCTOR_KEY } from '../api/config';
import { Avatar, cartoonAvatarUri } from '../components/Avatar';
import { DoctorProfileCard } from '../components/DoctorProfileCard';
import { ChatThread } from '../components/ChatThread';
import { ChevronLeftIcon, CloseIcon, NotificationIcon, SearchIcon, PdfIcon, EditIcon, AddVisitIcon, ReferHcpIcon } from '../components/NavIcons';
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
import { colors } from '../theme/colors';
import { ReferralWorkspace } from './ReferralWorkspace';

type RouteState =
  | { name: 'list' }
  | { name: 'edit'; patientId: string }
  | { name: 'addVisit'; patientId: string }
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
  symptoms: SymptomEntry[];
  currentMedications: string;
  alcoholUse: 'None' | 'Social' | 'Daily';
  smokingStatus: 'Never smoker' | 'Former smoker' | 'Current smoker';
  immuneStatus: 'Immunocompromised' | 'Immunocompetent';
  pregnancyStatus: 'Pregnant' | 'Not Pregnant' | 'N/A';
  familyMedicalHistory: string;
  labResults: string;
};

type SymptomDraft = {
  name: string;
  duration: string;
  frequency: string;
  trigger: string;
  onset: SymptomOnset;
};

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
const SYMPTOM_COLORS = [
  { background: '#F0ECFF', border: '#E1D9FF', text: '#6852CC' },
  { background: '#E5F7F4', border: '#CDEEE8', text: '#167C73' },
  { background: '#FFF0EC', border: '#FFE0D8', text: '#C75F4D' },
];

function patientAccent(index: number, lightness = 48): string {
  const hue = (index * 137.508 + 18) % 360;
  const saturation = 0.68;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = normalizedLightness - chroma / 2;
  const [red, green, blue] = hue < 60
    ? [chroma, secondary, 0]
    : hue < 120
      ? [secondary, chroma, 0]
      : hue < 180
        ? [0, chroma, secondary]
        : hue < 240
          ? [0, secondary, chroma]
          : hue < 300
            ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

const EMPTY_SYMPTOM: SymptomDraft = {
  name: '',
  duration: '',
  frequency: '',
  trigger: '',
  onset: 'Gradual',
};

function makeVisitForm(patient: PatientProfile): VisitForm {
  return {
    symptoms: [],
    currentMedications: '',
    alcoholUse: 'None',
    smokingStatus: 'Never smoker',
    immuneStatus: 'Immunocompetent',
    pregnancyStatus: patient.sex === 'Female' ? 'Not Pregnant' : 'N/A',
    familyMedicalHistory: '',
    labResults: '',
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
  const [doctorDirectory, setDoctorDirectory] = useState<DoctorProfile[]>([]);
  const [route, setRoute] = useState<RouteState>({ name: 'list' });
  const [query, setQuery] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [consultThreads, setConsultThreads] = useState<DoctorThread[]>([]);
  const [confirmReferralOpen, setConfirmReferralOpen] = useState(false);
  const [referralSuccessMessage, setReferralSuccessMessage] = useState<string | null>(null);
  const [referralReason, setReferralReason] = useState('Please evaluate this patient.');
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [hcpSearchQuery, setHcpSearchQuery] = useState('');
  const [rankedHcps, setRankedHcps] = useState<DoctorProfile[] | null>(null);
  const [similarCases, setSimilarCases] = useState<SimilarCase[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [emailPrompt, setEmailPrompt] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [apiDoctors, setApiDoctors] = useState<DoctorProfile[]>([]);
  const [currentDoctor, setCurrentDoctor] = useState<CurrentDoctor | null>(null);
  const [formalReferralPatient, setFormalReferralPatient] = useState<PatientProfile | null>(null);

  const [visitForm, setVisitForm] = useState<VisitForm | null>(null);
  const [addSymptomOpen, setAddSymptomOpen] = useState(false);
  const [symptomDraft, setSymptomDraft] = useState<SymptomDraft>(EMPTY_SYMPTOM);

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
        if (!cancelled) setPatients(rows.length > 0 ? rows : PATIENTS);
      })
      .catch(() => {
        if (!cancelled) {
          setPatients(PATIENTS);
          setInfoMessage('Showing demo panel — API patient load failed.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadConsultDirectory()
      .then(({ directory }) => {
        if (!cancelled) setDoctorDirectory(directory);
      })
      .catch(() => {
        if (!cancelled) setInfoMessage('Could not load doctors from the API.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!suitableMode) return;
    setRoute({ name: 'list' });
    setSelectedPatientId(null);
    setInfoMessage(null);
    setQuery('');
    // Hardcoded cohort panel for finder mode
    setPatients(PATIENTS);
  }, [suitableMode]);

  const exitSuitableMode = () => {
    onExitSuitableMode?.();
    loadMyPatients()
      .then((rows) => setPatients(rows.length > 0 ? rows : PATIENTS))
      .catch(() => setPatients(PATIENTS));
  };

  const routedPatientId =
    route.name === 'list' ? null : route.patientId;

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

  const selectedPatient = useMemo(
    () =>
      selectedPatientId
        ? patients.find((patient) => patient.id === selectedPatientId) ?? null
        : null,
    [patients, selectedPatientId],
  );

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const base = !normalized
      ? patients
      : patients.filter((patient) => {
          const symptomText = patient.symptoms.map((symptom) => symptom.name).join(' ');
          return (
            patient.name.toLowerCase().includes(normalized) ||
            patient.diagnosis.toLowerCase().includes(normalized) ||
            symptomText.toLowerCase().includes(normalized)
          );
        });

    if (!suitableMode) return base;

    return [...base].sort((a, b) => {
      const aMatch = HIGH_MATCH_SET.has(a.id) ? 0 : 1;
      const bMatch = HIGH_MATCH_SET.has(b.id) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.name.localeCompare(b.name);
    });
  }, [patients, query, suitableMode]);

  const highMatchPatients = useMemo(
    () => patients.filter((patient) => HIGH_MATCH_SET.has(patient.id)),
    [patients],
  );

  /** Send Notification only after Notification → Find Suitable Patients. */
  const sheetActions = useMemo(
    () => (suitableMode ? [SEND_NOTIFICATION_ACTION, ...ACTIONS] : ACTIONS),
    [suitableMode],
  );

  const headerTitle =
    route.name === 'list'
      ? suitableMode
        ? 'Patient Cohort'
        : 'Patients'
      : route.name === 'edit'
        ? routedPatient?.name ?? 'Patient Details'
        : route.name === 'hcpList'
          ? 'Ask/Refer an HCP'
          : route.name === 'doctorProfile'
            ? routedDoctor?.name ?? 'Doctor Profile'
            : route.name === 'doctorChat'
              ? routedDoctor?.name ?? 'Doctor Chat'
        : route.name === 'visitDetails'
          ? 'Visit Details'
          : 'Add Visit';

  const headerSubtitle =
    suitableMode && route.name === 'list'
      ? suitableSource?.brand
        ? `${suitableSource.brand} · ${highMatchPatients.length} high matches`
        : `${highMatchPatients.length} high matches`
      : route.name === 'list'
        ? `${patients.length} patients`
      : route.name === 'edit'
        ? 'Patient details and visit history'
        : route.name === 'hcpList'
          ? 'Search by doctor name or specialization'
          : route.name === 'doctorProfile'
            ? routedDoctor
              ? `${routedDoctor.specializations.slice(0, 2).join(' · ')}`
              : 'Doctor details'
            : route.name === 'doctorChat'
              ? routedDoctor?.designation ?? 'Consult thread'
        : route.name === 'visitDetails'
          ? activeVisit
            ? `${activeVisit.date} · ${activeVisit.diagnosis}`
            : 'Past visit snapshot'
          : routedPatient
            ? `${routedPatient.name} · Age ${routedPatient.age}`
            : 'Visit intake';

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

  const openAddVisit = (patientId: string) => {
    const patient = patients.find((entry) => entry.id === patientId);
    if (!patient) return;
    setVisitForm(makeVisitForm(patient));
    setSymptomDraft(EMPTY_SYMPTOM);
    setAddSymptomOpen(false);
    setInfoMessage(null);
    setSelectedPatientId(null);
    setRoute({ name: 'addVisit', patientId });
  };

  const openEdit = (patientId: string) => {
    setInfoMessage(null);
    setSelectedPatientId(null);
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
    setReferralError(null);
    setReferralReason('Please evaluate this patient.');
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
    setReferralError(null);
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
      setEmailPrompt('');
      setEmailOpen(true);
      return;
    }
    if (action === 'find-similar') {
      const patientId = selectedPatient.id;
      setSelectedPatientId(null);
      setSimilarLoading(true);
      setSimilarCases([]);
      loadSimilarCases(patientId)
        .then(setSimilarCases)
        .catch(() => {
          setSimilarCases(null);
          setInfoMessage('Could not load similar patients.');
        })
        .finally(() => setSimilarLoading(false));
      return;
    }
    if (action === 'generate-pdf') {
      const url = recordPdfUrl(selectedPatient.id);
      setSelectedPatientId(null);
      if (Platform.OS === 'web' && typeof globalThis.open === 'function') {
        globalThis.open(url, '_blank');
      } else {
        Linking.openURL(url).catch(() => setInfoMessage('Could not open the medical record.'));
      }
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
    if (route.name === 'list') {
      if (suitableMode) exitSuitableMode();
      return;
    }
    if (route.name === 'addVisit' || route.name === 'visitDetails') {
      setAddSymptomOpen(false);
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

  const saveVisit = () => {
    if (route.name !== 'addVisit' || !visitForm) return;
    const enteredSymptoms = visitForm.symptoms;
    const medications = visitForm.currentMedications.trim();
    const familyHistory = visitForm.familyMedicalHistory.trim();
    const labs = visitForm.labResults.trim();
    const firstSymptoms = visitForm.symptoms
      .slice(0, 2)
      .map((symptom) => symptom.name)
      .join(', ');

    const newVisit: PastVisit = {
      id: `visit-${Date.now()}`,
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
      diagnosis: routedPatient?.diagnosis ?? 'Follow-up Assessment',
      summary:
        firstSymptoms.length > 0
          ? `Symptoms tracked: ${firstSymptoms}. Intake fields updated.`
          : 'Visit details updated from latest intake.',
      symptoms: enteredSymptoms.map((symptom) => ({ ...symptom })),
      currentMedications: medications || 'Not provided',
      alcoholUse: visitForm.alcoholUse,
      smokingStatus: visitForm.smokingStatus,
      immuneStatus: visitForm.immuneStatus,
      pregnancyStatus: visitForm.pregnancyStatus,
      familyMedicalHistory: familyHistory || 'Not provided',
      labResults: labs || 'Not provided',
    };

    setPatients((current) =>
      current.map((patient) =>
        patient.id !== route.patientId
          ? patient
          : {
              ...patient,
              currentMedications: medications || patient.currentMedications,
              alcoholUse: visitForm.alcoholUse,
              smokingStatus: visitForm.smokingStatus,
              immuneStatus: visitForm.immuneStatus,
              pregnancyStatus: visitForm.pregnancyStatus,
              familyMedicalHistory: familyHistory || patient.familyMedicalHistory,
              labResults: labs || patient.labResults,
              symptoms:
                enteredSymptoms.length > 0 ? enteredSymptoms : patient.symptoms,
              pastVisits: [newVisit, ...patient.pastVisits],
            },
      ),
    );

    setInfoMessage('Visit saved and appended to past visit details.');
    setAddSymptomOpen(false);
    setRoute({ name: 'edit', patientId: route.patientId });
  };

  const confirmDoctorReferral = async () => {
    if (route.name !== 'doctorProfile' || !routedDoctor || !routedPatient) return;
    if (!/^P\d+$/i.test(routedPatient.id)) {
      setReferralError('This demo patient is not in the backend. Select a patient from your live clinic panel.');
      return;
    }
    if (referralReason.trim().length < 5) {
      setReferralError('Enter a referral reason with at least 5 characters.');
      return;
    }
    setReferralSubmitting(true);
    setReferralError(null);
    try {
      const result = await createFormalReferral({
        toDoctorKey: routedDoctor.id,
        patientKey: routedPatient.id,
        reason: referralReason.trim(),
        urgency: 'routine',
      });
      setConfirmReferralOpen(false);
      setReferralSuccessMessage(
        `Referral ${result.referral.referral_key} created for ${routedPatient.name}. The receiving doctor can view the handoff after accepting.`,
      );
    } catch (error) {
      setReferralError(error instanceof Error ? error.message : 'Could not create the referral.');
    } finally {
      setReferralSubmitting(false);
    }
  };
  const showBack = route.name !== 'list' || suitableMode;

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
        ) : null}
      </View>

      <View style={styles.body}>
        {route.name === 'list' ? (
          <View style={styles.flex}>
            {!suitableMode ? (
              <View style={styles.searchBar}>
                <SearchIcon color={colors.searchPlaceholder} size={18} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search patients, diagnosis, or symptoms"
                  placeholderTextColor={colors.searchPlaceholder}
                  style={styles.searchInput}
                  onSubmitEditing={Keyboard.dismiss}
                />
              </View>
            ) : null}

            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.listContent}
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

              {infoMessage ? (
                <View style={styles.infoBanner}>
                  <Text style={styles.infoBannerText}>{infoMessage}</Text>
                </View>
              ) : null}

              {filteredPatients.map((patient) => {
                const stablePatientIndex = patients.findIndex((entry) => entry.id === patient.id);
                const accent = patientAccent(stablePatientIndex);
                const isHighMatch = suitableMode && HIGH_MATCH_SET.has(patient.id);
                const initials = patient.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toUpperCase();
                return (
                  <Pressable
                    key={patient.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open actions for ${patient.name}`}
                    accessibilityHint="Opens patient actions and details"
                    onPress={() => {
                      Keyboard.dismiss();
                      setSelectedPatientId(patient.id);
                    }}
                    style={({ pressed }) => [
                      styles.patientCard,
                      isHighMatch && styles.patientCardMatch,
                      pressed && styles.patientCardPressed,
                    ]}
                  >
                    <View style={styles.patientCardHead}>
                      <View style={styles.patientIdentity}>
                        <Avatar
                          initials={initials}
                          color={accent}
                          size={38}
                          imageUri={cartoonAvatarUri(
                            `demo-patient-${stablePatientIndex + 1}`,
                            patientAccent(stablePatientIndex, 89),
                          )}
                        />
                        <View style={styles.patientIdentityCopy}>
                          <Text
                            style={[
                              styles.patientName,
                              isHighMatch && styles.patientNameMatch,
                            ]}
                            numberOfLines={1}
                          >
                            {patient.name}
                          </Text>
                          <Text style={styles.patientAge}>Age {patient.age}</Text>
                        </View>
                      </View>
                      <View style={styles.patientCardHeadRight}>
                        {isHighMatch ? (
                          <View style={styles.matchBadge}>
                            <Text style={styles.matchBadgeText}>MATCH</Text>
                          </View>
                        ) : null}
                        <Text style={styles.patientChevron}>›</Text>
                      </View>
                    </View>

                    <View style={styles.symptomsRow}>
                      {patient.symptoms.slice(0, 3).map((symptom, index) => {
                        const symptomColor =
                          SYMPTOM_COLORS[(index + stablePatientIndex) % SYMPTOM_COLORS.length];
                        return (
                        <View
                          key={symptom.id}
                          style={[
                            styles.symptomPill,
                            { backgroundColor: symptomColor.background, borderColor: symptomColor.border },
                            isHighMatch && styles.symptomPillMatch,
                          ]}
                        >
                          <Text
                            style={[
                              styles.symptomPillText,
                              { color: symptomColor.text },
                              isHighMatch && styles.symptomPillTextMatch,
                            ]}
                          >
                            {symptom.name}
                          </Text>
                        </View>
                        );
                      })}
                    </View>

                    <View style={styles.clinicalSummary}>
                      <View style={styles.clinicalSummaryRow}>
                        <View style={[styles.clinicalIllustration, styles.diagnosisIllustration]}>
                          <Text style={styles.clinicalIllustrationEmoji}>🩺</Text>
                        </View>
                        <Text
                          style={styles.clinicalSummaryLabel}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.72}
                        >
                          DIAGNOSIS
                        </Text>
                        <Text
                          style={[styles.clinicalSummaryValue, { color: accent }]}
                          numberOfLines={1}
                        >
                          {patient.diagnosis}
                        </Text>
                      </View>
                      <View style={styles.clinicalSummaryDivider} />
                      <View style={styles.clinicalSummaryRow}>
                        <View style={[styles.clinicalIllustration, styles.prescriptionIllustration]}>
                          <Text style={styles.clinicalIllustrationEmoji}>💊</Text>
                        </View>
                        <Text
                          style={styles.clinicalSummaryLabel}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.72}
                        >
                          PRESCRIPTION
                        </Text>
                        <Text
                          style={[styles.clinicalSummaryValue, styles.prescriptionSummaryValue]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.78}
                        >
                          {patient.prescription}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : route.name === 'edit' && routedPatient ? (
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
              <DetailRow label="Age Group" value={routedPatient.ageGroup} />
              <DetailRow label="Sex" value={routedPatient.sex} />
              <DetailRow
                label="Relevant Medical History"
                value={routedPatient.relevantMedicalHistory}
                multiline
              />
              <DetailRow
                label="Family Medical History"
                value={routedPatient.familyMedicalHistory}
                multiline
              />
              <DetailRow
                label="Current Medications"
                value={routedPatient.currentMedications}
                multiline
              />
              <DetailRow label="Alcohol" value={routedPatient.alcoholUse} />
              <DetailRow label="Smoking" value={routedPatient.smokingStatus} />
              <DetailRow label="Immune Status" value={routedPatient.immuneStatus} />
              <DetailRow label="Pregnancy" value={routedPatient.pregnancyStatus} />
              <DetailRow label="Lab Results" value={routedPatient.labResults} multiline />
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
                    <Text style={styles.visitHint}>Tap to view full visit details</Text>
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
              <Text style={styles.sectionTitle}>Current Intake (Read Only)</Text>
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
              <Text style={styles.sectionTitle}>Family History + Labs (Read Only)</Text>
              <DetailRow
                label="Family Medical History"
                value={activeVisit.familyMedicalHistory}
                multiline
              />
              <DetailRow label="Lab Results" value={activeVisit.labResults} multiline />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a new visit"
              onPress={() => openAddVisit(routedPatient.id)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Add New Visit</Text>
            </Pressable>
          </ScrollView>
        ) : route.name === 'hcpList' && routedPatient ? (
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
                        ? doctor.subspecialtyFocus ?? ''
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
              <Text style={styles.sectionTitle}>Family History + Labs</Text>
              <Text style={styles.fieldLabel}>Family Medical History</Text>
              <TextInput
                value={visitForm.familyMedicalHistory}
                onChangeText={(value) => updateVisitForm('familyMedicalHistory', value)}
                multiline
                style={[styles.textArea, styles.input]}
                placeholder="Include relevant hereditary conditions"
                placeholderTextColor={colors.searchPlaceholder}
              />

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
              onPress={saveVisit}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Save Visit</Text>
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
          </View>
        </View>
      ) : null}

      {similarCases ? (
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetOverlay} onPress={() => setSimilarCases(null)} />
          <View style={[styles.sheetCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Similar patients</Text>
            <ScrollView style={styles.similarList}>
              {similarLoading ? (
                <Text style={styles.emptySectionText}>Finding stored matches...</Text>
              ) : similarCases.length === 0 ? (
                <Text style={styles.emptySectionText}>No stored similar cases yet.</Text>
              ) : (
                similarCases.map((match) => (
                  <View key={match.patient_key} style={styles.similarRow}>
                    <Text style={styles.similarTitle}>
                      {match.age_group} · {match.sex_label}
                    </Text>
                    <Text style={styles.similarMeta}>{match.diagnosis_label}</Text>
                    <Text style={styles.similarMeta}>{match.matching_feature}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      ) : null}

      {confirmReferralOpen &&
      route.name === 'doctorProfile' &&
      routedDoctor &&
      routedPatient ? (
        <View style={styles.confirmRoot} pointerEvents="box-none">
          <Pressable
            style={styles.confirmOverlay}
            onPress={() => setConfirmReferralOpen(false)}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Confirm Referral</Text>
            <Text style={styles.confirmText}>
              Create a formal referral for {routedPatient.name} to {routedDoctor.name}. The
              receiving doctor can view the clinical handoff after accepting.
            </Text>
            <TextInput
              accessibilityLabel="Referral reason"
              value={referralReason}
              onChangeText={setReferralReason}
              placeholder="Reason for referral"
              multiline
              maxLength={1000}
              style={styles.referralReasonInput}
            />
            {referralError ? <Text style={styles.referralError}>{referralError}</Text> : null}
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setConfirmReferralOpen(false)}
                disabled={referralSubmitting}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={confirmDoctorReferral}
                disabled={referralSubmitting || referralReason.trim().length < 5}
                style={[styles.referBtn, (referralSubmitting || referralReason.trim().length < 5) && styles.referBtnDisabled]}
              >
                <Text style={styles.referBtnText}>{referralSubmitting ? 'Sending…' : 'Refer'}</Text>
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
    backgroundColor: 'rgba(79, 61, 158, 0.96)',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerSuitable: {
    backgroundColor: '#287C83',
    borderBottomColor: 'rgba(255,255,255,0.25)',
    borderBottomWidth: 1,
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
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  headerTitleSuitable: {
    color: colors.white,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 1,
  },
  headerSubtitleSuitable: {
    color: 'rgba(255,255,255,0.78)',
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
  body: {
    flex: 1,
  },
  searchBar: {
    marginTop: 12,
    marginHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: Platform.OS === 'web' ? 13 : 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#070B20',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 96,
    gap: 10,
  },
  trialBlock: {
    gap: 8,
  },
  trialEyebrow: {
    color: '#367E86',
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
    color: colors.navy,
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
    color: colors.navy,
    fontSize: 13,
    fontWeight: '600',
  },
  patientCard: {
    backgroundColor: 'rgba(255,255,255,0.93)',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 15,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#080D24',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.13,
    shadowRadius: 15,
    elevation: 4,
  },
  patientCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  patientCardMatch: {
    borderWidth: 2,
    borderColor: colors.matchRed,
    backgroundColor: 'rgba(255,253,252,0.94)',
  },
  patientCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  patientIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  patientIdentityCopy: {
    flex: 1,
    minWidth: 0,
  },
  patientCardHeadRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  patientName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.25,
    flex: 1,
  },
  patientNameMatch: {
    color: colors.textPrimary,
  },
  patientAge: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  patientChevron: {
    color: '#A5A8B5',
    fontSize: 25,
    fontWeight: '400',
    lineHeight: 27,
    marginLeft: 1,
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
    gap: 6,
  },
  symptomPill: {
    backgroundColor: '#F2F3F7',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  symptomPillMatch: {
    backgroundColor: 'rgba(229, 57, 53, 0.08)',
  },
  symptomPillText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.05,
  },
  symptomPillTextMatch: {
    color: colors.textSecondary,
  },
  clinicalSummary: {
    backgroundColor: 'rgba(248,248,252,0.86)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  clinicalSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clinicalIllustration: {
    width: 25,
    height: 25,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagnosisIllustration: {
    backgroundColor: '#E9E4FF',
  },
  prescriptionIllustration: {
    backgroundColor: '#FFE5DF',
  },
  clinicalIllustrationEmoji: {
    fontSize: 14,
  },
  clinicalSummaryLabel: {
    width: 72,
    color: '#8A8EA1',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  clinicalSummaryValue: {
    flex: 1,
    minWidth: 0,
    color: '#30364A',
    fontSize: 12,
    fontWeight: '600',
  },
  prescriptionSummaryValue: {
    fontSize: 11,
  },
  clinicalSummaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E6E7EF',
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
  referralReasonInput: {
    minHeight: 72,
    marginTop: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.22)',
    borderRadius: 10,
    color: colors.textPrimary,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  referralError: {
    color: '#B42318',
    fontSize: 13,
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
  referBtnDisabled: {
    opacity: 0.55,
  },
  referBtnText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  emailBox: {
    marginTop: 12,
    gap: 10,
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
  similarTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  similarMeta: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
});
