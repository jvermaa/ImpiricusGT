import { CURRENT_DOCTOR_KEY } from './config';

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

const DEMO_PROFILES: Record<string, DoctorCardModel> = {
  D031: {
    doctorKey: 'D031',
    displayName: 'Dr. Aisha Reed',
    credentials: 'DO',
    headline: 'Dr. Aisha Reed, DO',
    initials: 'AR',
    specialty: 'Neurology',
    specialtyTitle: 'Neurologist',
    subspecialtyFocus: 'Migraine',
    practiceType: 'academic',
    organization: 'Fictional Care Group 3',
    state: 'AL',
    yearsInPractice: 5,
    languages: ['English', 'Spanish'],
    bio: 'Neurologist focused on practical, collaborative care for people living with migraine.',
    acceptsPeerConsults: true,
    caseExchangeOptIn: false,
    isSelf: true,
    canMessage: false,
    canRefer: false,
    messageBlockReason: null,
    referBlockReason: null,
    mutualThreadId: null,
    mutualLastMessage: null,
    patientCount: 3,
    consultThreadCount: 3,
    referralsIn: 0,
    referralsOut: 0,
  },
};

function fallbackProfile(doctorKey: string): DoctorCardModel {
  const isSelf = doctorKey === CURRENT_DOCTOR_KEY;
  const suffix = doctorKey.replace(/\D/g, '') || '1';
  return {
    doctorKey,
    displayName: `Dr. Demo Colleague ${suffix}`,
    credentials: 'MD',
    headline: `Dr. Demo Colleague ${suffix}, MD`,
    initials: 'DC',
    specialty: 'Internal Medicine',
    specialtyTitle: 'Internal Medicine',
    subspecialtyFocus: 'Complex Care',
    practiceType: 'group practice',
    organization: 'Impiricus Demo Network',
    state: 'GA',
    yearsInPractice: 8,
    languages: ['English'],
    bio: 'This is a synthetic demo profile for peer collaboration.',
    acceptsPeerConsults: true,
    caseExchangeOptIn: true,
    isSelf,
    canMessage: !isSelf,
    canRefer: !isSelf,
    messageBlockReason: null,
    referBlockReason: null,
    mutualThreadId: null,
    mutualLastMessage: null,
    patientCount: isSelf ? 3 : null,
    consultThreadCount: isSelf ? 3 : 0,
    referralsIn: 0,
    referralsOut: 0,
  };
}

const profileStore = new Map<string, DoctorCardModel>(
  Object.entries(DEMO_PROFILES).map(([key, profile]) => [key, { ...profile }]),
);

function savedProfile(doctorKey: string): DoctorCardModel {
  const existing = profileStore.get(doctorKey);
  if (existing) return existing;
  const created = fallbackProfile(doctorKey);
  profileStore.set(doctorKey, created);
  return created;
}

/** Profile data is deliberately local and deterministic for the hackathon demo. */
export async function loadDoctorProfile(doctorKey: string): Promise<DoctorCardModel> {
  const profile = savedProfile(doctorKey);
  return { ...profile, languages: [...profile.languages] };
}

export async function updateDoctorSettings(
  doctorKey: string,
  patch: Partial<DoctorSettingsDTO>,
): Promise<DoctorSettingsDTO> {
  const profile = savedProfile(doctorKey);
  if (patch.accepts_peer_consults !== undefined) profile.acceptsPeerConsults = patch.accepts_peer_consults;
  if (patch.case_exchange_opt_in !== undefined) profile.caseExchangeOptIn = patch.case_exchange_opt_in;
  return {
    accepts_peer_consults: profile.acceptsPeerConsults,
    case_exchange_opt_in: profile.caseExchangeOptIn,
  };
}

export async function updateDoctorBio(doctorKey: string, bio: string): Promise<string | null> {
  const profile = savedProfile(doctorKey);
  profile.bio = bio.trim() || null;
  return profile.bio;
}

export async function loadPanelPatients(): Promise<PanelPatient[]> {
  return [
    { patientKey: 'P-DEMO-1', label: 'Synthetic patient A', detail: 'Adult · Migraine' },
    { patientKey: 'P-DEMO-2', label: 'Synthetic patient B', detail: 'Older adult · Hypertension' },
    { patientKey: 'P-DEMO-3', label: 'Synthetic patient C', detail: 'Adult · Neuropathic pain' },
  ];
}
