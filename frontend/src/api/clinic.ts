import type { ChatMessage, CurrentDoctor, DoctorProfile, DoctorThread } from '../types/chat';
import type { PastVisit, PatientProfile, SymptomEntry } from '../data/patientMock';
import { API_BASE_URL, CURRENT_DOCTOR_KEY } from './config';

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
  year: number;
  reason: string;
  assessment: string;
  plan: string;
};

type PatientDTO = {
  patient_key: string;
  display_label: string;
  age_group: string;
  age_years: number | null;
  sex_label: PatientProfile['sex'];
  primary_diagnosis: string;
  symptom_labels: string[];
  active_medication_summary: string;
  tobacco_label: PatientProfile['smokingStatus'];
  pregnancy_label: PatientProfile['pregnancyStatus'];
  family_history: string;
  surgery_history: string;
  lab_summary: string;
  encounters: EncounterDTO[];
};

const NGROK_HEADER = 'ngrok-skip-browser-warning';

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
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

function toSymptom(patientKey: string, label: string, index: number): SymptomEntry {
  return {
    id: `${patientKey}-symptom-${index}`,
    name: label,
    duration: 'Not recorded',
    frequency: 'Not recorded',
    trigger: 'Not recorded',
    onset: 'Gradual',
  };
}

function toPatient(row: PatientDTO): PatientProfile {
  const symptoms = row.symptom_labels.map((label, index) => toSymptom(row.patient_key, label, index));
  const pastVisits: PastVisit[] = row.encounters.map((encounter) => ({
    id: encounter.encounter_key,
    date: String(encounter.year),
    diagnosis: row.primary_diagnosis,
    summary: `${encounter.reason}. ${encounter.assessment} ${encounter.plan}`,
    symptoms,
    currentMedications: row.active_medication_summary,
    alcoholUse: 'Not recorded',
    smokingStatus: row.tobacco_label,
    immuneStatus: 'Not recorded',
    pregnancyStatus: row.pregnancy_label,
    familyMedicalHistory: row.family_history,
    labResults: row.lab_summary,
  }));

  return {
    id: row.patient_key,
    name: row.display_label,
    age: row.age_years ?? 0,
    sex: row.sex_label,
    ageGroup: row.age_group,
    diagnosis: row.primary_diagnosis,
    prescription: row.active_medication_summary,
    relevantMedicalHistory: row.surgery_history,
    familyMedicalHistory: row.family_history,
    currentMedications: row.active_medication_summary,
    alcoholUse: 'Not recorded',
    smokingStatus: row.tobacco_label,
    immuneStatus: 'Not recorded',
    pregnancyStatus: row.pregnancy_label,
    labResults: row.lab_summary,
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
  const response = await fetch(`${API_BASE_URL}/consults?doctor=${CURRENT_DOCTOR_KEY}`, {
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
  const response = await fetch(
    `${API_BASE_URL}/consults/${encodeURIComponent(threadId)}/messages?doctor=${CURRENT_DOCTOR_KEY}`,
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

export type SimilarCase = {
  patient_key: string;
  age_group: string;
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
  return `${API_BASE_URL}/patients/${encodeURIComponent(patientKey)}/record.pdf?doctor=${CURRENT_DOCTOR_KEY}`;
}

export async function sendPromptEmail(
  patientKey: string,
  prompt: string,
): Promise<{ subject: string; body: string; source: string; status: string; detail: string }> {
  const response = await fetch(
    `${API_BASE_URL}/patients/${encodeURIComponent(patientKey)}/prompt-email?doctor=${CURRENT_DOCTOR_KEY}`,
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
