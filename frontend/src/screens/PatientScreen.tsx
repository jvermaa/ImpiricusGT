import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeftIcon, CloseIcon, SearchIcon } from '../components/NavIcons';
import {
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
  | { name: 'visitDetails'; patientId: string; visitId: string };

type ActionKey =
  | 'find-similar'
  | 'generate-pdf'
  | 'send-notification'
  | 'edit-patient'
  | 'add-visit';

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
];

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

export function PatientScreen() {
  const insets = useSafeAreaInsets();
  const [patients, setPatients] = useState<PatientProfile[]>(PATIENTS);
  const [route, setRoute] = useState<RouteState>({ name: 'list' });
  const [query, setQuery] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [visitForm, setVisitForm] = useState<VisitForm | null>(null);
  const [addSymptomOpen, setAddSymptomOpen] = useState(false);
  const [symptomDraft, setSymptomDraft] = useState<SymptomDraft>(EMPTY_SYMPTOM);

  const routedPatientId =
    route.name === 'list' ? null : route.patientId;

  const routedPatient = useMemo(
    () =>
      routedPatientId
        ? patients.find((patient) => patient.id === routedPatientId) ?? null
        : null,
    [patients, routedPatientId],
  );

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
    if (!normalized) return patients;
    return patients.filter((patient) => {
      const symptomText = patient.symptoms.map((symptom) => symptom.name).join(' ');
      return (
        patient.name.toLowerCase().includes(normalized) ||
        patient.diagnosis.toLowerCase().includes(normalized) ||
        symptomText.toLowerCase().includes(normalized)
      );
    });
  }, [patients, query]);

  const headerTitle =
    route.name === 'list'
      ? 'Patients'
      : route.name === 'edit'
        ? routedPatient?.name ?? 'Patient Details'
        : route.name === 'visitDetails'
          ? 'Visit Details'
          : 'Add Visit';

  const headerSubtitle =
    route.name === 'list'
      ? 'Peer cohort records'
      : route.name === 'edit'
        ? 'Patient details and visit history'
        : route.name === 'visitDetails'
          ? activeVisit
            ? `${activeVisit.date} · ${activeVisit.diagnosis}`
            : 'Past visit snapshot'
          : routedPatient
            ? `${routedPatient.name} · Age ${routedPatient.age}`
            : 'Visit intake';

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

    const label = ACTIONS.find((entry) => entry.key === action)?.label ?? 'Action';
    setInfoMessage(`${label} is ready for backend wiring.`);
    setSelectedPatientId(null);
  };

  const goBack = () => {
    if (route.name === 'list') return;
    if (route.name === 'addVisit' || route.name === 'visitDetails') {
      setAddSymptomOpen(false);
      setRoute({ name: 'edit', patientId: route.patientId });
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

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={route.name === 'list' ? 'Patients' : 'Go back'}
          onPress={route.name === 'list' ? undefined : goBack}
          disabled={route.name === 'list'}
          style={styles.headerLeft}
        >
          {route.name !== 'list' ? (
            <ChevronLeftIcon color={colors.white} size={22} />
          ) : null}
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {headerTitle}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.body}>
        {route.name === 'list' ? (
          <View style={styles.flex}>
            <View style={styles.searchBar}>
              <SearchIcon color={colors.searchPlaceholder} size={18} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search patients, diagnosis, or symptoms"
                placeholderTextColor={colors.searchPlaceholder}
                style={styles.searchInput}
              />
            </View>

            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {infoMessage ? (
                <View style={styles.infoBanner}>
                  <Text style={styles.infoBannerText}>{infoMessage}</Text>
                </View>
              ) : null}

              {filteredPatients.map((patient) => (
                <Pressable
                  key={patient.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open actions for ${patient.name}`}
                  onPress={() => setSelectedPatientId(patient.id)}
                  style={styles.patientCard}
                >
                  <View style={styles.patientCardHead}>
                    <Text style={styles.patientName}>{patient.name}</Text>
                    <Text style={styles.patientAge}>Age {patient.age}</Text>
                  </View>

                  <View style={styles.symptomsRow}>
                    {patient.symptoms.slice(0, 3).map((symptom) => (
                      <View key={symptom.id} style={styles.symptomPill}>
                        <Text style={styles.symptomPillText}>{symptom.name}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.metaText}>Dx: {patient.diagnosis}</Text>
                  <Text style={styles.metaText}>Rx: {patient.prescription}</Text>
                </Pressable>
              ))}
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
                Age {selectedPatient.age} · {selectedPatient.diagnosis}
              </Text>
            </View>
            {ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={() => handleAction(action.key)}
                style={styles.sheetAction}
              >
                <Text style={styles.sheetActionText}>{action.label}</Text>
              </Pressable>
            ))}
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
    paddingVertical: 4,
    paddingRight: 12,
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 1,
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
  infoBanner: {
    backgroundColor: 'rgba(123, 97, 255, 0.2)',
    borderColor: 'rgba(123, 97, 255, 0.45)',
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
  },
  patientCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  patientName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  patientAge: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
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
  symptomPillText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
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
  },
  sheetActionText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
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
});
