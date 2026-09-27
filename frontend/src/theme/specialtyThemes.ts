export type SpecialtyIconName =
  | 'heart'
  | 'brain'
  | 'lungs'
  | 'droplet'
  | 'hand'
  | 'joint'
  | 'stomach'
  | 'stethoscope'
  | 'cross';

export type SpecialtyTheme = {
  gradient: readonly [string, string];
  accent: string;
  icon: SpecialtyIconName;
};

/** Accents stay light enough to read on the navy background. */
const THEMES: Record<string, SpecialtyTheme> = {
  Cardiology: {
    gradient: ['#4A1830', '#C4476A'],
    accent: '#FF8BA7',
    icon: 'heart',
  },
  Neurology: {
    gradient: ['#241848', '#6A56C8'],
    accent: '#C4B5FD',
    icon: 'brain',
  },
  Pulmonology: {
    gradient: ['#0E2A44', '#2E7EAE'],
    accent: '#8ED4FF',
    icon: 'lungs',
  },
  Endocrinology: {
    gradient: ['#0E3330', '#1F8A7A'],
    accent: '#7EE6D4',
    icon: 'droplet',
  },
  Dermatology: {
    gradient: ['#3A2414', '#C47A3A'],
    accent: '#F0B27A',
    icon: 'hand',
  },
  Rheumatology: {
    gradient: ['#3A3014', '#B8963A'],
    accent: '#F0D58A',
    icon: 'joint',
  },
  Gastroenterology: {
    gradient: ['#123018', '#3C8A4E'],
    accent: '#9BE7A8',
    icon: 'stomach',
  },
  'Primary Care': {
    gradient: ['#10243A', '#3A78B4'],
    accent: '#9ECAFF',
    icon: 'stethoscope',
  },
};

const FALLBACK: SpecialtyTheme = {
  gradient: ['#1A1F3A', '#5C52A8'],
  accent: '#C4B5FD',
  icon: 'cross',
};

export function themeForSpecialty(specialty: string): SpecialtyTheme {
  return THEMES[specialty] ?? FALLBACK;
}
