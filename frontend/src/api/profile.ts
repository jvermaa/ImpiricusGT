import { API_BASE_URL, CURRENT_DOCTOR_KEY } from './config';

const NGROK_HEADER = 'ngrok-skip-browser-warning';

export type DoctorIdentityDTO = {
  doctor_key: string;
  display_name: string;
  credentials: string;
  initials: string;
  specialty: string;
  specialty_title: string;
  subspecialty_focus: string;
  practice_type: string;
  organization: string;
  state: string;
  years_in_practice: number;
  languages: string[];
};

export type DoctorSettingsDTO = {
  accepts_peer_consults: boolean;
  case_exchange_opt_in: boolean;
};

export type DoctorStatsDTO = {
  patient_count: number;
  peer_consult_threads: number;
  referrals_received: number;
  referrals_sent: number;
  case_polls_answered: number;
};

export type DoctorProfileDTO = {
  identity: DoctorIdentityDTO;
  settings: DoctorSettingsDTO;
  stats: DoctorStatsDTO;
  verification: 'demo';
  is_self: boolean;
  has_consult_thread: boolean;
  professional_email?: string;
};

export type DoctorCardModel = {
  doctorKey: string;
  displayName: string;
  credentials: string;
  headline: string;
  initials: string;
  specialty: string;
  specialtyTitle: string;
  subspecialtyFocus: string;
  practiceType: string;
  organization: string;
  state: string;
  yearsInPractice: number;
  languages: string[];
  acceptsPeerConsults: boolean;
  caseExchangeOptIn: boolean;
  patientCount: number;
  peerConsultThreads: number;
  referralsReceived: number;
  referralsSent: number;
  casePollsAnswered: number;
  verification: 'demo';
  isSelf: boolean;
  hasConsultThread: boolean;
  professionalEmail: string | null;
};

function headers(jsonBody: boolean): Record<string, string> {
  const value: Record<string, string> = {
    [NGROK_HEADER]: 'true',
    Accept: 'application/json',
  };
  if (jsonBody) value['Content-Type'] = 'application/json';
  return value;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
  } catch {
    // Non-JSON error bodies stay as the status line.
  }
  return `API ${response.status}`;
}

export function toDoctorCard(dto: DoctorProfileDTO): DoctorCardModel {
  const identity = dto.identity;
  return {
    doctorKey: identity.doctor_key,
    displayName: identity.display_name,
    credentials: identity.credentials,
    headline: `${identity.display_name}, ${identity.credentials}`,
    initials: identity.initials,
    specialty: identity.specialty,
    specialtyTitle: identity.specialty_title,
    subspecialtyFocus: identity.subspecialty_focus,
    practiceType: identity.practice_type,
    organization: identity.organization,
    state: identity.state,
    yearsInPractice: identity.years_in_practice,
    languages: identity.languages,
    acceptsPeerConsults: dto.settings.accepts_peer_consults,
    caseExchangeOptIn: dto.settings.case_exchange_opt_in,
    patientCount: dto.stats.patient_count,
    peerConsultThreads: dto.stats.peer_consult_threads,
    referralsReceived: dto.stats.referrals_received,
    referralsSent: dto.stats.referrals_sent,
    casePollsAnswered: dto.stats.case_polls_answered,
    verification: dto.verification,
    isSelf: dto.is_self,
    hasConsultThread: dto.has_consult_thread,
    professionalEmail: dto.professional_email ?? null,
  };
}

export async function loadDoctorProfile(doctorKey: string): Promise<DoctorCardModel> {
  const params = new URLSearchParams({ viewer: CURRENT_DOCTOR_KEY });
  const response = await fetch(
    `${API_BASE_URL}/doctors/${encodeURIComponent(doctorKey)}/profile?${params.toString()}`,
    { headers: headers(false) },
  );
  if (!response.ok) throw new Error(await readError(response));
  return toDoctorCard((await response.json()) as DoctorProfileDTO);
}

export async function updateDoctorSettings(
  doctorKey: string,
  patch: Partial<Pick<DoctorSettingsDTO, 'accepts_peer_consults' | 'case_exchange_opt_in'>>,
): Promise<DoctorSettingsDTO> {
  const params = new URLSearchParams({ viewer: CURRENT_DOCTOR_KEY });
  const response = await fetch(
    `${API_BASE_URL}/doctors/${encodeURIComponent(doctorKey)}/settings?${params.toString()}`,
    {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as DoctorSettingsDTO;
}
