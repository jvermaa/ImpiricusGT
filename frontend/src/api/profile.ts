import { API_BASE_URL, CURRENT_DOCTOR_KEY } from './config';

const NGROK_HEADER = 'ngrok-skip-browser-warning';

export type DoctorProfileDTO = {
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
  bio: string | null;
  accepts_peer_consults: boolean;
  case_exchange_opt_in: boolean;
  is_self: boolean;
  can_message: boolean;
  can_refer: boolean;
  message_block_reason?: string;
  refer_block_reason?: string;
  mutual_thread_id?: string;
  mutual_last_message?: string;
  patient_count?: number;
  consult_thread_count: number;
  referrals_in: number;
  referrals_out: number;
};

export type DoctorSettingsDTO = {
  accepts_peer_consults: boolean;
  case_exchange_opt_in: boolean;
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
  bio: string | null;
  acceptsPeerConsults: boolean;
  caseExchangeOptIn: boolean;
  isSelf: boolean;
  canMessage: boolean;
  canRefer: boolean;
  messageBlockReason: string | null;
  referBlockReason: string | null;
  mutualThreadId: string | null;
  mutualLastMessage: string | null;
  patientCount: number | null;
  consultThreadCount: number;
  referralsIn: number;
  referralsOut: number;
};

export type PanelPatient = {
  patientKey: string;
  label: string;
  detail: string;
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
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === 'string' && payload.detail) return payload.detail;
    if (Array.isArray(payload.detail) && payload.detail.length > 0) {
      const first = payload.detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
  } catch {
    // Non-JSON bodies stay as the status line.
  }
  return `API ${response.status}`;
}

export function toDoctorCard(dto: DoctorProfileDTO): DoctorCardModel {
  return {
    doctorKey: dto.doctor_key,
    displayName: dto.display_name,
    credentials: dto.credentials,
    headline: `${dto.display_name}, ${dto.credentials}`,
    initials: dto.initials,
    specialty: dto.specialty,
    specialtyTitle: dto.specialty_title,
    subspecialtyFocus: dto.subspecialty_focus,
    practiceType: dto.practice_type,
    organization: dto.organization,
    state: dto.state,
    yearsInPractice: dto.years_in_practice,
    languages: dto.languages,
    bio: dto.bio,
    acceptsPeerConsults: dto.accepts_peer_consults,
    caseExchangeOptIn: dto.case_exchange_opt_in,
    isSelf: dto.is_self,
    canMessage: dto.can_message,
    canRefer: dto.can_refer,
    messageBlockReason: dto.message_block_reason ?? null,
    referBlockReason: dto.refer_block_reason ?? null,
    mutualThreadId: dto.mutual_thread_id ?? null,
    mutualLastMessage: dto.mutual_last_message ?? null,
    patientCount: dto.patient_count ?? null,
    consultThreadCount: dto.consult_thread_count,
    referralsIn: dto.referrals_in,
    referralsOut: dto.referrals_out,
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
  patch: Partial<DoctorSettingsDTO>,
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

export async function updateDoctorBio(doctorKey: string, bio: string): Promise<string | null> {
  const params = new URLSearchParams({ viewer: CURRENT_DOCTOR_KEY });
  const response = await fetch(
    `${API_BASE_URL}/doctors/${encodeURIComponent(doctorKey)}/profile?${params.toString()}`,
    {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify({ bio }),
    },
  );
  if (!response.ok) throw new Error(await readError(response));
  const saved = (await response.json()) as { bio: string | null };
  return saved.bio;
}

type PatientRow = {
  patient_key: string;
  display_label: string;
  age_group?: string;
  primary_diagnosis?: string;
};

export async function loadPanelPatients(): Promise<PanelPatient[]> {
  const response = await fetch(`${API_BASE_URL}/patients?doctor=${CURRENT_DOCTOR_KEY}`, {
    headers: headers(false),
  });
  if (!response.ok) throw new Error(await readError(response));
  const rows = (await response.json()) as PatientRow[];
  return rows.map((row) => ({
    patientKey: row.patient_key,
    label: row.display_label,
    detail: `${row.age_group ?? 'Age n/a'} · ${row.primary_diagnosis ?? 'No diagnosis'}`,
  }));
}
