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
import { CURRENT_DOCTOR_KEY } from '../api/config';
import { Avatar } from '../components/Avatar';
import { DoctorProfileCard } from '../components/DoctorProfileCard';
import { ChatThread } from '../components/ChatThread';
import { ChevronLeftIcon, CloseIcon, NotificationIcon, SearchIcon } from '../components/NavIcons';
import type { AppNotification } from '../data/notificationsMock';
import { DOCTOR_DIRECTORY, type DoctorProfile } from '../data/chatMock';
import type { ChatMessage, DoctorThread } from '../types/chat';
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

const ACTIONS: Array<{ key: ActionKey; label: string }> = [
  { key: 'find-similar', label: 'Find Similar Patients' },
  { key: 'generate-pdf', label: 'Generate Medical Record PDF' },
  { key: 'send-notification', label: 'Send Notification' },
  { key: 'edit-patient', label: 'Edit Patient Details' },
  { key: 'add-visit', label: 'Add Visit' },
  { key: 'ask-refer-hcp', label: 'Ask/Refer an HCP' },
];

const HIGH_MATCH_SET = new Set<string>(HIGH_MATCH_PATIENT_IDS);

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
  const [route, setRoute] = useState<RouteState>({ name: 'list' });
  const [query, setQuery] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [consultThreads, setConsultThreads] = useState<DoctorThread[]>([]);
  const [confirmReferralOpen, setConfirmReferralOpen] = useState(false);
  const [referralSuccessMessage, setReferralSuccessMessage] = useState<string | null>(null);
  const [hcpSearchQuery, setHcpSearchQuery] = useState('');
  const [rankedHcps, setRankedHcps] = useState<DoctorProfile[] | null>(null);
  const [similarCases, setSimilarCases] = useState<SimilarCase[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [emailPrompt, setEmailPrompt] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [apiDoctors, setApiDoctors] = useState<DoctorProfile[]>([]);

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
    setHcpSearchQuery('');
    setRankedHcps(null);
    loadRankedDoctors(patientId)
      .then(setRankedHcps)
      .catch(() => setRankedHcps([]));
    setInfoMessage(null);
    setReferralSuccessMessage(null);
    setConfirmReferralOpen(false);
    setRoute({ name: 'hcpList', patientId });
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

    const label = ACTIONS.find((entry) => entry.key === action)?.label ?? 'Action';
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

  const confirmDoctorReferral = () => {
    if (route.name !== 'doctorProfile' || !routedDoctor || !routedPatient) return;
    setConfirmReferralOpen(false);
    setReferralSuccessMessage(
      `Referral sent to ${routedPatient.name}. Email delivered with ${routedDoctor.name}'s details and medical history shared immediately.`,
    );
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
                const isHighMatch = suitableMode && HIGH_MATCH_SET.has(patient.id);
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
              <View style={styles.infoBanner}>
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
            {ACTIONS.map((action) => {
              const emphasized =
                action.key === 'find-similar' || action.key === 'send-notification';
              const iconColor = emphasized ? colors.skyBlue : colors.textMuted;
              return (
                <Pressable
                  key={action.key}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => handleAction(action.key)}
                  style={[styles.sheetAction, emphasized && styles.sheetActionPrimary]}
                >
                  <View style={styles.sheetActionInner}>
                    {action.key === 'find-similar' ? (
                      <SearchIcon color={iconColor} size={18} />
                    ) : action.key === 'send-notification' ? (
                      <NotificationIcon color={iconColor} size={18} />
                    ) : (
                      <View style={styles.sheetActionIconSpacer} />
                    )}
                    <Text
                      style={[
                        styles.sheetActionText,
                        emphasized && styles.sheetActionTextPrimary,
                      ]}
                    >
                      {action.label}
                    </Text>
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
  infoBanner: {
    backgroundColor: colors.skyBlueSoft,
    borderColor: colors.skyBlueBorder,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
