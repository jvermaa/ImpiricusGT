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
  doctor_key: string;
  display_name: string;
  initials: string;
  specialty: string;
  specialty_title: string;
  last_message: string;
};

type MessageDTO = {
  message_key: string;
  sender_doctor_key: string;
  text: string;
  timestamp: string;
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`API ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

function colorFor(key: string): string {
  const index = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return PALETTE[index % PALETTE.length];
}

function toProfile(doctor: DoctorDTO | ConsultDTO): DoctorProfile {
  return {
    id: doctor.doctor_key,
    name: doctor.display_name,
    designation: doctor.specialty_title,
    specialty: doctor.specialty,
    initials: doctor.initials,
    avatarColor: colorFor(doctor.doctor_key),
  };
}

function toMessage(message: MessageDTO): ChatMessage {
  return {
    id: message.message_key,
    senderId: message.sender_doctor_key,
    text: message.text,
    timestamp: message.timestamp,
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
  const threads = consults.map((consult) => ({
    ...toProfile(consult),
    lastMessage: consult.last_message || 'No messages yet',
    messages: [] as ChatMessage[],
  }));
  const specialties = ['All', ...Array.from(new Set(threads.map((thread) => thread.specialty))).sort()];
  return { directory, threads, specialties };
}

export async function loadThreadMessages(peerDoctorKey: string): Promise<ChatMessage[]> {
  const rows = await getJson<MessageDTO[]>(
    `/consults/${peerDoctorKey}/messages?doctor=${CURRENT_DOCTOR_KEY}`,
  );
  return rows.map(toMessage);
}

export async function sendConsultMessage(peerDoctorKey: string, text: string): Promise<ChatMessage> {
  const response = await fetch(`${API_BASE_URL}/consults/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      doctor_key: CURRENT_DOCTOR_KEY,
      peer_doctor_key: peerDoctorKey,
      text,
    }),
  });
  if (!response.ok) {
    throw new Error(`API ${response.status} while sending a consult message`);
  }
  return toMessage((await response.json()) as MessageDTO);
}

export async function loadMyPatients(): Promise<PatientProfile[]> {
  const rows = await getJson<PatientDTO[]>(`/patients?doctor=${CURRENT_DOCTOR_KEY}`);
  return rows.map(toPatient);
}
