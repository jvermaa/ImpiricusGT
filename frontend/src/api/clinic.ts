import type { ChatMessage, CurrentDoctor, DoctorProfile, DoctorThread } from '../types/chat';
import type { PastVisit, PatientProfile, SymptomEntry, SymptomOnset } from '../data/patientMock';
import { API_BASE_URL, CURRENT_DOCTOR_KEY, FALLBACK_API_BASE_URL } from './config';

const PALETTE = ['#7B61FF', '#4A90A4', '#C45B7A', '#5B8C5A', '#6B7FD7', '#D4A017', '#9B59B6', '#2E8B7A'];

type DoctorDTO = {
  doctor_key: string;
  display_name: string;
  initials: string;
  specialty: string;
  specialty_title: string;
  accepts_peer_consults: boolean;
};

type ConsultDTO = {
  thread_id: string;
  doctor_key: string;
  display_name: string;
  initials: string;
  specialty: string;
  specialty_title: string;
  last_message: { text: string; created_at: string } | null;
};

type MessageDTO = {
  id: number;
  thread_id: string;
  sender_doctor_key: string;
  text: string;
  created_at: string;
};

type EncounterDTO = {
  encounter_key: string;
  visit_date: string;
  diagnosis: string;
  summary: string;
  symptoms: Array<{
    name: string;
    duration: string;
    frequency: string;
    trigger: string;
    onset: SymptomOnset;
  }>;
  current_medications: string;
  alcohol_use: PastVisit['alcoholUse'];
  smoking_status: PastVisit['smokingStatus'];
  immune_status: PastVisit['immuneStatus'];
  pregnancy_status: PastVisit['pregnancyStatus'];
  lab_results: string;
};

type PatientDTO = {
  patient_key: string;
  display_label: string;
  age: number;
  sex_label: string;
  primary_diagnosis: string;
  relevant_medical_history: string;
  family_medical_history: string;
  current_medications: string;
  alcohol_use: PatientProfile['alcoholUse'];
  smoking_status: PatientProfile['smokingStatus'];
  pregnancy_status: PatientProfile['pregnancyStatus'];
  immune_status: PatientProfile['immuneStatus'];
  lab_results: string;
  latest_visit_symptoms: EncounterDTO['symptoms'];
  encounters: EncounterDTO[];
};

const NGROK_HEADER = 'ngrok-skip-browser-warning';
let activeApiBaseUrl = API_BASE_URL;

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

function canFallback(baseUrl: string): boolean {
  return Boolean(FALLBACK_API_BASE_URL && FALLBACK_API_BASE_URL !== baseUrl);
}

async function apiFetch(
  path: string,
  init?: RequestInit,
  options?: { retryOnNotFound?: boolean },
): Promise<Response> {
  const primaryBase = activeApiBaseUrl;
  const fallbackBase = FALLBACK_API_BASE_URL;
  try {
    const response = await fetch(apiUrl(primaryBase, path), init);
    if (
      response.status === 404 &&
      options?.retryOnNotFound &&
      fallbackBase &&
      fallbackBase !== primaryBase
    ) {
      const fallbackResponse = await fetch(apiUrl(fallbackBase, path), init);
      if (fallbackResponse.ok) {
        activeApiBaseUrl = fallbackBase;
      }
      return fallbackResponse;
    }
    return response;
  } catch (error) {
    if (!canFallback(primaryBase) || !fallbackBase) {
      throw error;
    }
    const fallbackResponse = await fetch(apiUrl(fallbackBase, path), init);
    activeApiBaseUrl = fallbackBase;
    return fallbackResponse;
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
  } catch {
    // Non-JSON bodies stay as the status line.
  }
  return `API ${response.status}`;
}

function jsonHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    [NGROK_HEADER]: 'true',
  };
}

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {
    headers: { Accept: 'application/json', [NGROK_HEADER]: 'true' },
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json() as Promise<T>;
}

function colorFor(key: string): string {
  const index = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return PALETTE[index % PALETTE.length];
}

function distanceFor(key: string): number {
  const hash = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Number((1 + (hash % 100) / 10).toFixed(1));
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function defaultSpecializations(specialty: string, specialtyTitle: string): string[] {
  const readable = titleCase(specialty);
  const base = specialtyTitle || readable;
  if (base.toLowerCase().includes('cardio')) return [base, 'Heart Failure'];
  if (base.toLowerCase().includes('pulmo')) return [base, 'Critical Care'];
  if (base.toLowerCase().includes('neuro')) return [base, 'Movement Disorders'];
  if (base.toLowerCase().includes('rheum')) return [base, 'Autoimmune Disease'];
  if (base.toLowerCase().includes('endo')) return [base, 'Diabetes Care'];
  return [base, readable].filter((entry, index, arr) => arr.indexOf(entry) === index);
}

function addressFor(key: string): string {
  const suffix = key
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)
    .toString()
    .slice(-3);
  return `${100 + Number(suffix || 0)} Peachtree St NE, Atlanta, GA`;
}

function toProfile(doctor: DoctorDTO | ConsultDTO): DoctorProfile {
  const specializations = defaultSpecializations(doctor.specialty, doctor.specialty_title);
  return {
    id: doctor.doctor_key,
    name: doctor.display_name,
    designation: doctor.specialty_title,
    specialty: doctor.specialty,
    specializations,
    degrees: ['MD'],
    address: addressFor(doctor.doctor_key),
    distanceKm: distanceFor(doctor.doctor_key),
    initials: doctor.initials,
    avatarColor: colorFor(doctor.doctor_key),
  };
}

function formatStamp(iso: string): string {
  const date = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toMessage(message: MessageDTO): ChatMessage {
  return {
    id: String(message.id),
    senderId: message.sender_doctor_key,
    text: message.text,
    timestamp: formatStamp(message.created_at),
    status: 'saved',
  };
}

function toThread(consult: ConsultDTO): DoctorThread {
  return {
    ...toProfile(consult),
    id: consult.doctor_key,
    threadId: consult.thread_id,
    lastMessage: consult.last_message?.text || 'No messages yet',
    messages: [],
  };
}

function toSymptom(
  patientKey: string,
  symptom: { name: string; duration: string; frequency: string; trigger: string; onset: SymptomOnset },
  index: number,
  suffix = 'latest',
): SymptomEntry {
  return {
    id: `${patientKey}-${suffix}-symptom-${index}`,
    name: symptom.name,
    duration: symptom.duration,
    frequency: symptom.frequency,
    trigger: symptom.trigger,
    onset: symptom.onset,
  };
}

function toPatient(row: PatientDTO): PatientProfile {
  const pastVisits: PastVisit[] = row.encounters.map((encounter) => ({
    id: encounter.encounter_key,
    date: encounter.visit_date,
    diagnosis: encounter.diagnosis,
    summary: encounter.summary,
    symptoms: encounter.symptoms.map((symptom, index) =>
      toSymptom(row.patient_key, symptom, index, encounter.encounter_key),
    ),
    currentMedications: encounter.current_medications,
    alcoholUse: encounter.alcohol_use,
    smokingStatus: encounter.smoking_status,
    immuneStatus: encounter.immune_status,
    pregnancyStatus: encounter.pregnancy_status,
    labResults: encounter.lab_results,
  }));
  const latestSymptomsRaw = row.latest_visit_symptoms ?? [];
  const latestSymptoms =
    latestSymptomsRaw.length > 0 ? latestSymptomsRaw : row.encounters[0]?.symptoms ?? [];
  const symptoms = latestSymptoms.map((symptom, index) => toSymptom(row.patient_key, symptom, index));
  const sex: PatientProfile['sex'] = row.sex_label === 'Female' ? 'Female' : 'Male';

  return {
    id: row.patient_key,
    name: row.display_label,
    age: row.age,
    sex,
    diagnosis: row.primary_diagnosis,
    prescription: row.current_medications,
    relevantMedicalHistory: row.relevant_medical_history,
    familyMedicalHistory: row.family_medical_history,
    currentMedications: row.current_medications,
    alcoholUse: row.alcohol_use,
    smokingStatus: row.smoking_status,
    immuneStatus: row.immune_status,
    pregnancyStatus: row.pregnancy_status,
    labResults: row.lab_results,
    symptoms,
    pastVisits,
  };
}

export async function loadCurrentDoctor(): Promise<CurrentDoctor> {
  const doctor = await getJson<DoctorDTO>(`/doctors/${CURRENT_DOCTOR_KEY}`);
  return {
    id: doctor.doctor_key,
    name: doctor.display_name,
    designation: doctor.specialty_title,
    initials: doctor.initials,
  };
}

export async function loadConsultDirectory(): Promise<{
  directory: DoctorProfile[];
  threads: DoctorThread[];
  specialties: string[];
}> {
  const [doctors, consults] = await Promise.all([
    getJson<DoctorDTO[]>('/doctors'),
    getJson<ConsultDTO[]>(`/consults?doctor=${CURRENT_DOCTOR_KEY}`),
  ]);
  const directory = doctors
    .filter((doctor) => doctor.doctor_key !== CURRENT_DOCTOR_KEY)
    .map(toProfile);
  const threads = consults.map(toThread);
  const specialties = ['All', ...Array.from(new Set(threads.map((thread) => thread.specialty))).sort()];
  return { directory, threads, specialties };
}

export async function loadThreadMessages(threadId: string): Promise<ChatMessage[]> {
  const rows = await getJson<MessageDTO[]>(
    `/consults/${encodeURIComponent(threadId)}/messages?doctor=${CURRENT_DOCTOR_KEY}`,
  );
  return rows.map(toMessage);
}

export async function openConsultThread(peerDoctorKey: string): Promise<DoctorThread> {
  const response = await apiFetch(`/consults?doctor=${CURRENT_DOCTOR_KEY}`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ peer_doctor_key: peerDoctorKey }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return toThread((await response.json()) as ConsultDTO);
}

export async function sendConsultMessage(threadId: string, text: string): Promise<ChatMessage> {
  const response = await apiFetch(
    `/consults/${encodeURIComponent(threadId)}/messages?doctor=${CURRENT_DOCTOR_KEY}`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ text }),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return toMessage((await response.json()) as MessageDTO);
}

export async function loadMyPatients(): Promise<PatientProfile[]> {
  const rows = await getJson<PatientDTO[]>(`/patients?doctor=${CURRENT_DOCTOR_KEY}`);
  return rows.map(toPatient);
}

export type PatientWritePayload = {
  name?: string;
  age?: number;
  sex?: PatientProfile['sex'];
  diagnosis?: string;
  relevantMedicalHistory?: string;
  familyMedicalHistory?: string;
  currentMedications?: string;
  alcoholUse?: PatientProfile['alcoholUse'];
  smokingStatus?: PatientProfile['smokingStatus'];
  immuneStatus?: PatientProfile['immuneStatus'];
  pregnancyStatus?: PatientProfile['pregnancyStatus'];
  labResults?: string;
};

function toPatientRequest(payload: PatientWritePayload): Record<string, unknown> {
  const sex =
    payload.sex === 'Female'
      ? 'female'
      : payload.sex === 'Male'
        ? 'male'
        : undefined;
  return {
    name: payload.name,
    age: payload.age,
    sex_for_clinical_context: sex,
    primary_diagnosis: payload.diagnosis,
    relevant_medical_history: payload.relevantMedicalHistory,
    family_medical_history: payload.familyMedicalHistory,
    current_medications: payload.currentMedications,
    alcohol_use: payload.alcoholUse,
    smoking_status: payload.smokingStatus,
    immune_status: payload.immuneStatus,
    pregnancy_status: payload.pregnancyStatus,
    lab_results: payload.labResults,
  };
}

export async function createPatient(payload: PatientWritePayload): Promise<PatientProfile> {
  const response = await apiFetch(`/patients?doctor=${CURRENT_DOCTOR_KEY}`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(toPatientRequest(payload)),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const row = (await response.json()) as PatientDTO;
  return toPatient(row);
}

export async function savePatientDetails(
  patientKey: string,
  payload: PatientWritePayload,
): Promise<PatientProfile> {
  const response = await apiFetch(
    `/patients/${encodeURIComponent(patientKey)}?doctor=${CURRENT_DOCTOR_KEY}`,
    {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(toPatientRequest(payload)),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const row = (await response.json()) as PatientDTO;
  return toPatient(row);
}

export type SimilarCase = {
  patient_key: string;
  age: number;
  sex_label: string;
  diagnosis_label: string;
  matching_feature: string;
  score: number | null;
};

export async function loadSimilarCases(patientKey: string): Promise<SimilarCase[]> {
  return getJson<SimilarCase[]>(
    `/patients/${encodeURIComponent(patientKey)}/similar?doctor=${CURRENT_DOCTOR_KEY}`,
  );
}

export function recordPdfUrl(patientKey: string): string {
  return `${activeApiBaseUrl}/patients/${encodeURIComponent(patientKey)}/record.pdf?doctor=${CURRENT_DOCTOR_KEY}`;
}

export async function sendPromptEmail(
  patientKey: string,
  prompt: string,
): Promise<{ subject: string; body: string; source: string; status: string; detail: string }> {
  const response = await apiFetch(
    `/patients/${encodeURIComponent(patientKey)}/prompt-email?doctor=${CURRENT_DOCTOR_KEY}`,
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ prompt }),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function loadRankedDoctors(patientKey: string): Promise<DoctorProfile[]> {
  const payload = await getJson<{
    results: Array<{ provider: DoctorDTO; score: number; reasons: string[] }>;
  }>(
    `/referrals/directory?doctor=${CURRENT_DOCTOR_KEY}&patient_key=${encodeURIComponent(patientKey)}&limit=10`,
  );
  return payload.results.map((row, index) => ({
    ...toProfile(row.provider),
    distanceKm: index,
    subspecialtyFocus: row.reasons[0] ?? `Match score ${row.score}`,
  }));
}

export type VisitWritePayload = {
  visitDate?: string;
  diagnosis: string;
  summary: string;
  symptoms: Array<{
    name: string;
    duration: string;
    frequency: string;
    trigger: string;
    onset: SymptomOnset;
  }>;
  currentMedications: string;
  alcoholUse: PastVisit['alcoholUse'];
  smokingStatus: PastVisit['smokingStatus'];
  immuneStatus: PastVisit['immuneStatus'];
  pregnancyStatus: PastVisit['pregnancyStatus'];
  labResults: string;
};

function toVisitRequest(payload: VisitWritePayload): Record<string, unknown> {
  return {
    visit_date: payload.visitDate ?? null,
    diagnosis: payload.diagnosis,
    summary: payload.summary,
    symptoms: payload.symptoms,
    current_medications: payload.currentMedications,
    alcohol_use: payload.alcoholUse,
    smoking_status: payload.smokingStatus,
    immune_status: payload.immuneStatus,
    pregnancy_status: payload.pregnancyStatus,
    lab_results: payload.labResults,
  };
}

export async function savePatientVisit(
  patientKey: string,
  payload: VisitWritePayload,
  visitId?: string,
): Promise<PatientProfile> {
  const path = visitId
    ? `/patients/${encodeURIComponent(patientKey)}/visits/${encodeURIComponent(visitId)}`
    : `/patients/${encodeURIComponent(patientKey)}/visits`;
  const response = await apiFetch(
    `${path}?doctor=${CURRENT_DOCTOR_KEY}`,
    {
      method: visitId ? 'PATCH' : 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(toVisitRequest(payload)),
    },
    { retryOnNotFound: true },
  );
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  const row = (await response.json()) as PatientDTO;
  return toPatient(row);
}
