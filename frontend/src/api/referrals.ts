import { API_BASE_URL, CURRENT_DOCTOR_KEY } from './config';
import type {
  ReferralDetail,
  ReferralDirectoryEntry,
  ReferralMessage,
  ReferralSummary,
  ReferralUrgency,
} from '../types/referrals';

type DoctorDirectoryDTO = {
  doctor_key: string;
  display_name: string;
  initials: string;
  specialty: string;
  specialty_title: string;
  credentials: string;
  subspecialty_focus: string;
  practice_type: string;
  state: string;
  years_in_practice: number;
  languages: string[];
  organization: string;
};

type ReferralDirectoryDTO = {
  provider: DoctorDirectoryDTO;
  score: number;
  reasons: string[];
};

const AVATAR_PALETTE = ['#7B61FF', '#4A90A4', '#C45B7A', '#5B8C5A', '#6B7FD7', '#D4A017', '#9B59B6', '#2E8B7A'];

function doctorProfile(doctor: DoctorDirectoryDTO): ReferralDirectoryEntry['provider'] {
  const paletteIndex = doctor.doctor_key
    .split('')
    .reduce((sum, character) => sum + character.charCodeAt(0), 0) % AVATAR_PALETTE.length;

  const degrees = doctor.credentials ? doctor.credentials.split(',').map((value) => value.trim()).filter(Boolean) : ['MD'];

  return {
    id: doctor.doctor_key,
    name: doctor.display_name,
    designation: doctor.specialty_title,
    specialty: doctor.specialty,
    specializations: [doctor.specialty, doctor.subspecialty_focus].filter(Boolean),
    degrees,
    address: `${doctor.organization || 'Clinic'}, ${doctor.state || 'Unknown state'}`,
    distanceKm: 0,
    initials: doctor.initials,
    avatarColor: AVATAR_PALETTE[paletteIndex],
    specializations: [doctor.specialty_title || doctor.specialty],
    degrees: doctor.credentials ? [doctor.credentials] : [],
    address: doctor.state,
    distanceKm: 0,
    credentials: doctor.credentials,
    subspecialtyFocus: doctor.subspecialty_focus,
    practiceType: doctor.practice_type,
    state: doctor.state,
    yearsInPractice: doctor.years_in_practice,
    languages: doctor.languages,
    organization: doctor.organization,
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'ngrok-skip-browser-warning': 'true',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = `API ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) detail = payload.detail;
    } catch {
      // Keep the status-only message when the response isn't JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

export async function loadReferralDirectory(
  patientKey: string,
  specialty?: string,
): Promise<ReferralDirectoryEntry[]> {
  const params = new URLSearchParams({ doctor: CURRENT_DOCTOR_KEY, patient_key: patientKey });
  if (specialty) params.set('specialty', specialty);
  const response = await requestJson<{ results: ReferralDirectoryDTO[] }>(
    `/referrals/directory?${params.toString()}`,
  );
  return response.results.map((row) => ({ ...row, provider: doctorProfile(row.provider) }));
}

export function loadReferralList(
  direction: 'in' | 'out',
  withDoctor?: string,
): Promise<ReferralSummary[]> {
  const params = new URLSearchParams({ doctor: CURRENT_DOCTOR_KEY, direction });
  if (withDoctor) params.set('with', withDoctor);
  return requestJson<ReferralSummary[]>(`/referrals?${params.toString()}`);
}

export function loadMyReferrals(): Promise<ReferralSummary[]> {
  const params = new URLSearchParams({ doctor: CURRENT_DOCTOR_KEY });
  return requestJson<ReferralSummary[]>(`/referrals?${params.toString()}`);
}

export function loadReferral(referralKey: string): Promise<ReferralDetail> {
  const params = new URLSearchParams({ viewer: CURRENT_DOCTOR_KEY });
  return requestJson<ReferralDetail>(`/referrals/${encodeURIComponent(referralKey)}?${params.toString()}`);
}

export function createFormalReferral(input: {
  toDoctorKey: string;
  patientKey: string;
  reason: string;
  urgency: ReferralUrgency;
}): Promise<{ referral: ReferralSummary; messages: ReferralMessage[] }> {
  return requestJson('/referrals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_doctor_key: CURRENT_DOCTOR_KEY,
      to_doctor_key: input.toDoctorKey,
      patient_key: input.patientKey,
      reason: input.reason,
      urgency: input.urgency,
    }),
  });
}

export function updateReferralStatus(
  referralKey: string,
  status: 'accepted' | 'declined' | 'completed' | 'cancelled',
  outcome?: string,
): Promise<ReferralDetail> {
  return requestJson<ReferralDetail>(`/referrals/${encodeURIComponent(referralKey)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      actor_doctor_key: CURRENT_DOCTOR_KEY,
      ...(outcome ? { outcome } : {}),
    }),
  });
}

export function postReferralMessage(referralKey: string, text: string): Promise<ReferralMessage> {
  return requestJson<ReferralMessage>(`/referrals/${encodeURIComponent(referralKey)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender_doctor_key: CURRENT_DOCTOR_KEY, text }),
  });
}
