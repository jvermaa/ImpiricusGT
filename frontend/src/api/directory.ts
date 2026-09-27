import { API_BASE_URL } from './config';

const NGROK_HEADER = 'ngrok-skip-browser-warning';

export type DirectoryDoctorDTO = {
  doctor_key: string;
  display_name: string;
  initials: string;
  specialty: string;
  specialty_title: string;
  subspecialty_focus: string;
  practice_type: string;
  state: string;
  languages: string[];
  organization: string;
  accepts_peer_consults: boolean;
};

export type DirectoryDoctor = {
  doctorKey: string;
  displayName: string;
  initials: string;
  specialty: string;
  specialtyTitle: string;
  focus: string;
  practiceType: string;
  state: string;
  languages: string[];
  organization: string;
  acceptsPeerConsults: boolean;
};

export type DirectoryFilter = {
  specialty?: string;
  focus?: string;
  practiceType?: string;
  language?: string;
  state?: string;
  organization?: string;
  acceptingOnly?: boolean;
};

function toDirectoryDoctor(dto: DirectoryDoctorDTO): DirectoryDoctor {
  return {
    doctorKey: dto.doctor_key,
    displayName: dto.display_name,
    initials: dto.initials,
    specialty: dto.specialty,
    specialtyTitle: dto.specialty_title,
    focus: dto.subspecialty_focus,
    practiceType: dto.practice_type,
    state: dto.state,
    languages: dto.languages,
    organization: dto.organization,
    acceptsPeerConsults: dto.accepts_peer_consults,
  };
}

export async function loadDoctorDirectory(): Promise<DirectoryDoctor[]> {
  const response = await fetch(`${API_BASE_URL}/doctors`, {
    headers: {
      [NGROK_HEADER]: 'true',
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  const rows = (await response.json()) as DirectoryDoctorDTO[];
  return rows.map(toDirectoryDoctor);
}

export function filterDirectory(doctors: DirectoryDoctor[], query: string, filter: DirectoryFilter): DirectoryDoctor[] {
  const needle = query.trim().toLowerCase();
  return doctors.filter((doctor) => {
    if (needle && !doctor.displayName.toLowerCase().includes(needle)) return false;
    if (filter.specialty && doctor.specialty !== filter.specialty) return false;
    if (filter.focus && doctor.focus !== filter.focus) return false;
    if (filter.practiceType && doctor.practiceType !== filter.practiceType) return false;
    if (filter.language && !doctor.languages.includes(filter.language)) return false;
    if (filter.state && doctor.state !== filter.state) return false;
    if (filter.organization && doctor.organization !== filter.organization) return false;
    if (filter.acceptingOnly && !doctor.acceptsPeerConsults) return false;
    return true;
  });
}
