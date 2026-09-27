import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadMyPatients } from '../api/clinic';
import {
  createFormalReferral,
  loadReferralDirectory,
  loadReferral,
  postReferralMessage,
  updateReferralStatus,
} from '../api/referrals';
import { Avatar } from '../components/Avatar';
import { ChatThread } from '../components/ChatThread';
import { ChevronLeftIcon } from '../components/NavIcons';
import type { PatientProfile } from '../data/patientMock';
import type { CurrentDoctor, DoctorProfile, ChatMessage } from '../types/chat';
import type {
  HandoffSummary,
  ReferralDetail,
  ReferralDirectoryEntry,
  ReferralUrgency,
} from '../types/referrals';
import { colors } from '../theme/colors';

type Props = {
  currentDoctor: CurrentDoctor;
  provider?: DoctorProfile | null;
  /** Patient already chosen (e.g. Patient tab → Ask/Refer) — skip patient picker. */
  initialPatient?: PatientProfile | null;
  referralKey?: string | null;
  onClose: () => void;
  onMessageDoctor: (doctor: DoctorProfile) => void;
  onSaved: () => void;
};

type Page = 'profile' | 'patients' | 'providers' | 'confirm' | 'thread';

const URGENCIES: ReferralUrgency[] = ['routine', 'soon', 'urgent'];

function initialPage(
  referralKey: string | null | undefined,
  providerLocked: boolean,
  patientLocked: boolean,
): Page {
  if (referralKey) return 'thread';
  if (providerLocked) return 'patients';
  if (patientLocked) return 'providers';
  return 'profile';
}

export function ReferralWorkspace({
  currentDoctor,
  provider = null,
  initialPatient = null,
  referralKey = null,
  onClose,
  onMessageDoctor,
  onSaved,
}: Props) {
  const insets = useSafeAreaInsets();
  /** Doctor already chosen (e.g. Chat → Refer) — skip the ranked directory picker. */
  const providerLocked = Boolean(provider) && !referralKey;
  /** Patient already chosen (e.g. Patient → Ask/Refer) — skip patient picker. */
  const patientLocked = Boolean(initialPatient) && !providerLocked && !referralKey;
  const [page, setPage] = useState<Page>(
    initialPage(referralKey, providerLocked, patientLocked),
  );
  const [patients, setPatients] = useState<PatientProfile[]>([]);
  const [patient, setPatient] = useState<PatientProfile | null>(initialPatient);
  const [providerOptions, setProviderOptions] = useState<ReferralDirectoryEntry[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<DoctorProfile | null>(provider);
  const [providerReasons, setProviderReasons] = useState<string[]>([]);
  const [detail, setDetail] = useState<ReferralDetail | null>(null);
  const [reason, setReason] = useState('');
  const [urgency, setUrgency] = useState<ReferralUrgency>('routine');
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const [showOutcome, setShowOutcome] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProvider = selectedProvider ?? detail?.receiving_doctor ?? provider;
  const isRecipient = detail?.referral.to_doctor_key === currentDoctor.id;
  const threadMessages: ChatMessage[] = useMemo(
    () => (detail?.messages ?? []).map((message) => ({
      id: message.message_key,
      senderId: message.sender_doctor_key,
      text: message.text,
      timestamp: message.timestamp,
    })),
    [detail?.messages],
  );

  useEffect(() => {
    if (!referralKey) return;
    setBusy(true);
    loadReferral(referralKey)
      .then((row) => setDetail(row))
      .catch((reasonValue: unknown) => setError(errorText(reasonValue)))
      .finally(() => setBusy(false));
  }, [referralKey]);

  const choosePatient = async () => {
    setError(null);
    setBusy(true);
    try {
      const rows = await loadMyPatients();
      const realPatients = rows.filter((row) => /^P\d+/i.test(row.id));
      setPatients(realPatients);
      if (realPatients.length === 0) {
        setError('No API-backed patients are available for referral.');
        return;
      }
      setPage('patients');
    } catch (reasonValue) {
      setError(errorText(reasonValue));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!providerLocked) return;
    let cancelled = false;
    setError(null);
    setBusy(true);
    loadMyPatients()
      .then((rows) => {
        if (cancelled) return;
        const realPatients = rows.filter((row) => /^P\d+/i.test(row.id));
        setPatients(realPatients);
        if (realPatients.length === 0) {
          setError('No API-backed patients are available for referral.');
        }
      })
      .catch((reasonValue: unknown) => {
        if (!cancelled) setError(errorText(reasonValue));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerLocked]);

  useEffect(() => {
    if (!patientLocked || !initialPatient) return;
    let cancelled = false;
    setError(null);
    setBusy(true);
    setPatient(initialPatient);
    loadReferralDirectory(initialPatient.id)
      .then((entries) => {
        if (cancelled) return;
        setProviderOptions(entries);
        if (entries.length === 0) {
          setError('No other doctors are available in the directory.');
          return;
        }
        setSelectedProvider(entries[0].provider);
        setProviderReasons(entries[0].reasons);
      })
      .catch((reasonValue: unknown) => {
        if (!cancelled) setError(errorText(reasonValue));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientLocked, initialPatient]);

  const filteredPatients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return patients;
    return patients.filter((row) =>
      `${row.name} ${row.diagnosis} ${row.symptoms.map((symptom) => symptom.name).join(' ')}`
        .toLowerCase()
        .includes(needle),
    );
  }, [patients, search]);

  const sendReferral = async () => {
    if (!activeProvider || !patient || reason.trim().length < 5) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createFormalReferral({
        toDoctorKey: activeProvider.id,
        patientKey: patient.id,
        reason: reason.trim(),
        urgency,
      });
      const loaded = await loadReferral(created.referral.referral_key);
      setDetail(loaded);
      setPage('thread');
      onSaved();
    } catch (reasonValue) {
      setError(errorText(reasonValue));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (text: string) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await postReferralMessage(detail.referral.referral_key, text);
      setDetail(await loadReferral(detail.referral.referral_key));
      onSaved();
    } catch (reasonValue) {
      setError(errorText(reasonValue));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (
    status: 'accepted' | 'declined' | 'completed' | 'cancelled',
    completionOutcome?: string,
  ) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await updateReferralStatus(
        detail.referral.referral_key,
        status,
        completionOutcome,
      ));
      setShowOutcome(false);
      setOutcome('');
      onSaved();
    } catch (reasonValue) {
      setError(errorText(reasonValue));
    } finally {
      setBusy(false);
    }
  };

  const title = page === 'profile'
    ? 'Doctor profile'
    : page === 'patients'
      ? 'Choose a patient'
        : page === 'providers'
          ? 'Recommended doctors'
      : page === 'confirm'
        ? 'Confirm referral'
        : 'Referral thread';

  const back = () => {
    if (page === 'profile' || (page === 'thread' && referralKey)) {
      onClose();
    } else if (page === 'thread') {
      onClose();
    } else if (page === 'confirm') {
      setPage(providerLocked ? 'patients' : 'providers');
    } else if (page === 'providers') {
      if (patientLocked) {
        onClose();
      } else {
        setPage('patients');
      }
    } else if (page === 'patients') {
      if (providerLocked) {
        onClose();
      } else {
        setPage('profile');
      }
    }
  };

  return (
    <View style={[styles.overlay, { paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={back} style={styles.backButton}>
          <ChevronLeftIcon color={colors.white} size={22} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>{title}</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {activeProvider?.name ?? detail?.referral.patient_label ?? 'Doctor-to-doctor referral'}
          </Text>
        </View>
        {busy ? <ActivityIndicator color={colors.skyBlue} /> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {page === 'profile' && activeProvider ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.profileCard}>
            <Avatar initials={activeProvider.initials} color={activeProvider.avatarColor} size={64} />
            <Text style={styles.profileName}>{activeProvider.name}</Text>
            <Text style={styles.profileCredential}>{activeProvider.credentials ?? activeProvider.designation}</Text>
            <Text style={styles.profileSpecialty}>{activeProvider.specialty}</Text>
            {activeProvider.subspecialtyFocus ? <Text style={styles.profileFocus}>{activeProvider.subspecialtyFocus}</Text> : null}
            {activeProvider.organization ? <Text style={styles.profileDetail}>{activeProvider.organization}</Text> : null}
            {activeProvider.state ? <Text style={styles.profileDetail}>State: {activeProvider.state}</Text> : null}
            {activeProvider.yearsInPractice !== undefined ? (
              <Text style={styles.profileDetail}>{activeProvider.yearsInPractice} years in practice</Text>
            ) : null}
            {activeProvider.languages?.length ? (
              <Text style={styles.profileDetail}>Languages: {activeProvider.languages.join(', ')}</Text>
            ) : null}
          </View>
          <Text style={styles.locationNote}>Distance is not available in the current doctor directory.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onMessageDoctor(activeProvider)}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Open doctor chat</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={choosePatient}
            disabled={busy}
            style={[styles.primaryButton, busy && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>Refer a patient</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {page === 'patients' ? (
        <View style={styles.flex}>
          <View style={styles.searchWrap}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search your patients"
              placeholderTextColor={colors.searchPlaceholder}
              style={styles.searchInput}
            />
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {filteredPatients.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                onPress={() => {
                  setPatient(row);
                  setReason('');
                  setUrgency('routine');
                  setBusy(true);
                  setError(null);
                  const lockedDoctor = providerLocked ? activeProvider : null;
                  loadReferralDirectory(row.id)
                    .then((entries) => {
                      setProviderOptions(entries);
                      if (lockedDoctor) {
                        const match = entries.find((entry) => entry.provider.id === lockedDoctor.id);
                        setSelectedProvider(match?.provider ?? lockedDoctor);
                        setProviderReasons(match?.reasons ?? []);
                        setPage('confirm');
                        return;
                      }
                      const chosen = entries.find((entry) => entry.provider.id === activeProvider?.id)
                        ?? entries[0];
                      setSelectedProvider(chosen?.provider ?? null);
                      setProviderReasons(chosen?.reasons ?? []);
                      setPage('providers');
                    })
                    .catch((reasonValue: unknown) => setError(errorText(reasonValue)))
                    .finally(() => setBusy(false));
                }}
                style={styles.patientCard}
              >
                <Text style={styles.patientName}>{row.name}</Text>
                <Text style={styles.patientMeta}>Age {row.age} · {row.diagnosis}</Text>
                <Text style={styles.patientMeta} numberOfLines={1}>{row.symptoms.map((symptom) => symptom.name).slice(0, 3).join(' · ')}</Text>
              </Pressable>
            ))}
            {filteredPatients.length === 0 ? <Text style={styles.empty}>No matching patients.</Text> : null}
          </ScrollView>
        </View>
      ) : null}

      {page === 'providers' ? (
        <View style={styles.flex}>
          <Text style={styles.directoryHint}>
            Ranked by available case-term overlap and similar-case records; this is a navigation aid, not a clinical recommendation.
          </Text>
          <ScrollView contentContainerStyle={styles.content}>
            {providerOptions.map((entry) => {
              const chosen = entry.provider.id === activeProvider?.id;
              return (
                <Pressable
                  key={entry.provider.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  onPress={() => {
                    setSelectedProvider(entry.provider);
                    setProviderReasons(entry.reasons);
                  }}
                  style={[styles.providerOption, chosen && styles.providerOptionSelected]}
                >
                  <Avatar initials={entry.provider.initials} color={entry.provider.avatarColor} size={44} />
                  <View style={styles.providerOptionText}>
                    <Text style={styles.providerOptionName}>{entry.provider.name}</Text>
                    <Text style={styles.providerOptionSpecialty}>{entry.provider.specialty} · {entry.provider.subspecialtyFocus ?? entry.provider.designation}</Text>
                    {entry.reasons.map((item) => <Text key={item} style={styles.providerOptionReason}>{item}</Text>)}
                    {entry.reasons.length === 0 ? <Text style={styles.providerOptionReason}>No case-match signal found</Text> : null}
                  </View>
                  {chosen ? <Text style={styles.selectedLabel}>Selected</Text> : null}
                </Pressable>
              );
            })}
            {providerOptions.length === 0 ? (
              <Text style={styles.empty}>No other doctors are available in the directory.</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={!activeProvider || busy}
              onPress={() => setPage('confirm')}
              style={[styles.primaryButton, (!activeProvider || busy) && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>Continue with {activeProvider?.name ?? 'selected doctor'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}

      {page === 'confirm' && activeProvider && patient ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.patientCard}>
            <Text style={styles.patientName}>{patient.name}</Text>
            <Text style={styles.patientMeta}>Age {patient.age} · {patient.diagnosis}</Text>
            <Text style={styles.patientMeta}>To: {activeProvider.name} · {activeProvider.specialty}</Text>
            {providerReasons.map((item) => <Text key={item} style={styles.patientMeta}>Case-match signal: {item}</Text>)}
            {providerReasons.length === 0 ? (
              <Text style={styles.patientMeta}>No case-match signal from available diagnosis/symptom fields.</Text>
            ) : null}
          </View>
          <Text style={styles.fieldLabel}>Reason for referral</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="What should the receiving clinician evaluate?"
            placeholderTextColor={colors.searchPlaceholder}
            multiline
            style={styles.reasonInput}
          />
          <Text style={styles.fieldLabel}>Urgency</Text>
          <View style={styles.urgencyRow}>
            {URGENCIES.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: urgency === value }}
                onPress={() => setUrgency(value)}
                style={[styles.urgencyChip, urgency === value && styles.urgencyChipActive]}
              >
                <Text style={[styles.urgencyText, urgency === value && styles.urgencyTextActive]}>
                  {value[0].toUpperCase() + value.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.privacyNote}>
            Patient history stays hidden from the receiving clinician until they accept the referral.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={sendReferral}
            disabled={busy || reason.trim().length < 5}
            style={[styles.primaryButton, (busy || reason.trim().length < 5) && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Sending…' : 'Send referral'}</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      {page === 'thread' && detail ? (
        <View style={styles.threadBody}>
          <ScrollView style={styles.threadInfo} contentContainerStyle={styles.threadInfoContent}>
            <View style={styles.statusCard}>
              <Text style={styles.statusText}>{detail.referral.status.toUpperCase()} · {detail.referral.urgency.toUpperCase()}</Text>
              <Text style={styles.patientMeta}>{detail.referral.reason}</Text>
              {detail.referral.patient_label ? <Text style={styles.patientMeta}>Patient: {detail.referral.patient_label}</Text> : null}
            </View>
            {detail.patient_handoff ? <HandoffCard handoff={detail.patient_handoff} /> : (
              <Text style={styles.privacyNote}>
                {detail.referral.status === 'pending_patient_consent'
                  ? 'Waiting for the patient to approve or decline this referral by email. History stays private until they approve.'
                  : detail.referral.status === 'patient_declined'
                    ? 'The patient declined this referral. No handoff was shared with the specialist.'
                    : 'Patient history will be shared here after the patient approves the referral.'}
              </Text>
            )}
            {showOutcome ? (
              <View style={styles.outcomeCard}>
                <Text style={styles.fieldLabel}>Referral outcome</Text>
                <TextInput
                  value={outcome}
                  onChangeText={setOutcome}
                  placeholder="Document the outcome"
                  placeholderTextColor={colors.searchPlaceholder}
                  multiline
                  style={styles.reasonInput}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!outcome.trim() || busy}
                  onPress={() => changeStatus('completed', outcome.trim())}
                  style={[styles.primaryButton, (!outcome.trim() || busy) && styles.disabled]}
                >
                  <Text style={styles.primaryButtonText}>Complete referral</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.statusActions}>
              {(detail.referral.status === 'shared_with_specialist' || detail.referral.status === 'sent') &&
              isRecipient ? (
                <>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => changeStatus('accepted')} style={styles.primaryButton}>
                    <Text style={styles.primaryButtonText}>Accept referral</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => changeStatus('declined')} style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Decline</Text>
                  </Pressable>
                </>
              ) : null}
              {(detail.referral.status === 'pending_patient_consent' ||
                detail.referral.status === 'shared_with_specialist' ||
                detail.referral.status === 'sent') &&
              !isRecipient ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => changeStatus('cancelled')} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Cancel referral</Text>
                </Pressable>
              ) : null}
              {detail.referral.status === 'accepted' ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => setShowOutcome(true)} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Complete referral</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
          <View style={styles.chatArea}>
            <ChatThread
              messages={threadMessages}
              onSend={sendMessage}
              currentUserId={currentDoctor.id}
              peerNameForTheirs={(senderId) => senderId === detail.referral.from_doctor_key ? detail.referring_doctor.name : detail.receiving_doctor.name}
              placeholder="Message about this referral…"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function HandoffCard({ handoff }: { handoff: HandoffSummary }) {
  return (
    <View style={styles.handoffCard}>
      <Text style={styles.handoffTitle}>{handoff.patient_display_label} · Patient handoff</Text>
      <Text style={styles.handoffStatus}>{handoff.status}</Text>
      <Text style={styles.handoffRow}>Age: {handoff.age} · {handoff.sex_for_clinical_context} · {handoff.state}</Text>
      <Text style={styles.handoffRow}>Preferred language: {handoff.preferred_language}</Text>
      <HandoffSection
        title="Current symptoms"
        rows={handoff.symptoms.map(
          (row) => `${row.name} · ${row.duration} · ${row.frequency} · ${row.trigger} · ${row.onset}`,
        )}
      />
      <HandoffSection title="Relevant history" rows={[
        `Medical: ${handoff.relevant_medical_history}`,
        `Family: ${handoff.family_medical_history}`,
        `Allergy status: ${handoff.allergy_status}`,
        `Alcohol: ${handoff.alcohol_use}`,
        `Smoking: ${handoff.smoking_status}`,
        `Pregnancy: ${handoff.pregnancy_status}`,
        `Immune: ${handoff.immune_status}`,
        `Current medications: ${handoff.current_medications}`,
        `Lab summary: ${handoff.lab_results}`,
      ]} />
      <HandoffSection title="Diagnoses" rows={handoff.diagnoses.map((row) => `${row.label} · ${row.code} · ${row.status}`)} />
      <HandoffSection title="Allergies" rows={handoff.allergies.map((row) => `${row.substance}: ${row.reaction} · ${row.status}`)} />
      <HandoffSection title="Active medications" rows={handoff.active_prescriptions.map((row) => `${row.generic_medication} ${row.strength} · ${row.status}`)} />
      <HandoffSection title="Labs" rows={handoff.labs.map((row) => `${row.test_name}: ${row.value} ${row.unit} (${row.result_year}) · ${row.flag}`)} />
      <HandoffSection
        title="Recent encounters"
        rows={handoff.encounters.map((row) => `${row.visit_date}: ${row.diagnosis}. ${row.summary}`)}
      />
      {handoff.followups_pending_approval.length ? (
        <HandoffSection title="Follow-ups pending approval" rows={handoff.followups_pending_approval} />
      ) : null}
    </View>
  );
}

function HandoffSection({ title, rows }: { title: string; rows: string[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.handoffSection}>
      <Text style={styles.handoffSectionTitle}>{title}</Text>
      {rows.map((row, index) => <Text key={`${title}-${index}`} style={styles.handoffRow}>{row}</Text>)}
    </View>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The referral request could not be completed.';
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: colors.navy,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.14)',
  },
  backButton: { width: 38, height: 40, justifyContent: 'center' },
  headerText: { flex: 1 },
  headerTitle: { color: colors.white, fontSize: 17, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.64)', fontSize: 12, marginTop: 2 },
  error: { color: '#FFD1D1', paddingHorizontal: 16, paddingTop: 10, fontSize: 13 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  profileCard: {
    alignItems: 'center',
    gap: 8,
    padding: 20,
    borderRadius: 20,
    backgroundColor: colors.white,
  },
  profileName: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 4 },
  profileCredential: { color: colors.textSecondary, fontSize: 13 },
  profileSpecialty: { color: colors.accentPurple, fontSize: 15, fontWeight: '700' },
  profileFocus: { color: colors.textPrimary, fontSize: 14, textAlign: 'center' },
  profileDetail: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  locationNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center' },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPurple,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  secondaryButtonText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 14 },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    color: colors.textPrimary,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  directoryHint: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  providerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 15,
    backgroundColor: colors.white,
  },
  providerOptionSelected: {
    borderWidth: 2,
    borderColor: colors.accentPurple,
  },
  providerOptionText: { flex: 1, gap: 3 },
  providerOptionName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  providerOptionSpecialty: { color: colors.accentPurple, fontSize: 12, fontWeight: '600' },
  providerOptionReason: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  selectedLabel: { color: colors.accentPurple, fontSize: 10, fontWeight: '800' },
  patientCard: { backgroundColor: colors.white, borderRadius: 16, padding: 15, gap: 5 },
  patientName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  patientMeta: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  empty: { color: colors.white, textAlign: 'center', paddingTop: 28 },
  fieldLabel: { color: colors.white, fontSize: 13, fontWeight: '700', marginBottom: -5 },
  reasonInput: {
    minHeight: 112,
    maxHeight: 200,
    padding: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.94)',
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  urgencyRow: { flexDirection: 'row', gap: 8 },
  urgencyChip: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgencyChipActive: { backgroundColor: colors.skyBlueSoft, borderColor: colors.skyBlueBorder },
  urgencyText: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '600' },
  urgencyTextActive: { color: colors.skyBlue, fontWeight: '700' },
  privacyNote: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 18 },
  threadBody: { flex: 1 },
  threadInfo: { flexGrow: 0, flexShrink: 1, maxHeight: '56%' },
  threadInfoContent: { padding: 14, gap: 10 },
  statusCard: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 15, padding: 13, gap: 6 },
  statusText: { color: colors.accentPurple, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  handoffCard: { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 15, padding: 13 },
  handoffTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  handoffStatus: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  handoffSection: { marginTop: 11, gap: 4 },
  handoffSectionTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  handoffRow: { color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  statusActions: { gap: 8 },
  outcomeCard: { gap: 10 },
  chatArea: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)' },
});
