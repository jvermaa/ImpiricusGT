export type DoctorProfile = {
  id: string;
  name: string;
  designation: string;
  specialty: string;
  initials: string;
  avatarColor: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
};

export type DoctorThread = DoctorProfile & {
  lastMessage: string;
  messages: ChatMessage[];
};

/** Current user (also a doctor). */
export const CURRENT_DOCTOR = {
  id: 'me',
  name: 'Dr. Jordan Hale',
  designation: 'Attending Physician',
  initials: 'JH',
};

/** Full directory for starting new peer chats. */
export const DOCTOR_DIRECTORY: DoctorProfile[] = [
  {
    id: 'doc-1',
    name: 'Dr. Amira Patel',
    designation: 'Cardiologist',
    specialty: 'Cardiology',
    initials: 'AP',
    avatarColor: '#7B61FF',
  },
  {
    id: 'doc-2',
    name: 'Dr. Marcus Chen',
    designation: 'Infectious Disease',
    specialty: 'Infectious Disease',
    initials: 'MC',
    avatarColor: '#4A90A4',
  },
  {
    id: 'doc-3',
    name: 'Dr. Sofia Reyes',
    designation: 'Neurologist',
    specialty: 'Neurology',
    initials: 'SR',
    avatarColor: '#C45B7A',
  },
  {
    id: 'doc-4',
    name: 'Dr. Eli Nakamura',
    designation: 'Endocrinologist',
    specialty: 'Endocrinology',
    initials: 'EN',
    avatarColor: '#5B8C5A',
  },
  {
    id: 'doc-5',
    name: 'Dr. Priya Nair',
    designation: 'Pulmonologist',
    specialty: 'Pulmonology',
    initials: 'PN',
    avatarColor: '#6B7FD7',
  },
  {
    id: 'doc-6',
    name: 'Dr. James Okonkwo',
    designation: 'Nephrologist',
    specialty: 'Nephrology',
    initials: 'JO',
    avatarColor: '#D4A017',
  },
  {
    id: 'doc-7',
    name: 'Dr. Lena Vogt',
    designation: 'Rheumatologist',
    specialty: 'Rheumatology',
    initials: 'LV',
    avatarColor: '#9B59B6',
  },
  {
    id: 'doc-8',
    name: 'Dr. Hassan Al-Rashid',
    designation: 'Gastroenterologist',
    specialty: 'Gastroenterology',
    initials: 'HA',
    avatarColor: '#2E8B7A',
  },
  {
    id: 'doc-9',
    name: 'Dr. Claire Dubois',
    designation: 'Oncologist',
    specialty: 'Oncology',
    initials: 'CD',
    avatarColor: '#E07A5F',
  },
  {
    id: 'doc-10',
    name: 'Dr. Wei Zhang',
    designation: 'Cardiologist',
    specialty: 'Cardiology',
    initials: 'WZ',
    avatarColor: '#3D5A80',
  },
];

export const SPECIALTIES = [
  'All',
  ...Array.from(new Set(DOCTOR_DIRECTORY.map((d) => d.specialty))).sort(),
];

export const DOCTOR_THREADS: DoctorThread[] = [
  {
    ...DOCTOR_DIRECTORY[0],
    lastMessage: 'Happy to review the ECG when you have it.',
    messages: [
      {
        id: 'm1',
        senderId: 'me',
        text: 'Amira — I have a 58F with atypical chest pain and a borderline troponin. Would you take a quick look at the rhythm strip?',
        timestamp: '9:12 AM',
      },
      {
        id: 'm2',
        senderId: 'doc-1',
        text: 'Of course. Any prior CAD history or recent exertion?',
        timestamp: '9:14 AM',
      },
      {
        id: 'm3',
        senderId: 'me',
        text: 'No known CAD. Mild HTN on lisinopril. Pain started overnight, non-radiating.',
        timestamp: '9:15 AM',
      },
      {
        id: 'm4',
        senderId: 'doc-1',
        text: 'Happy to review the ECG when you have it. If ST changes are subtle, consider serial trop and admit for observation.',
        timestamp: '9:18 AM',
      },
    ],
  },
  {
    ...DOCTOR_DIRECTORY[1],
    lastMessage: 'I’d start empiric coverage and get cultures first.',
    messages: [
      {
        id: 'm1',
        senderId: 'me',
        text: 'Marcus, 72M post-op day 3 with fever 38.9 and rising WBC. Surgical site looks clean. Thoughts on ID workup?',
        timestamp: 'Yesterday',
      },
      {
        id: 'm2',
        senderId: 'doc-2',
        text: 'I’d start empiric coverage and get cultures first. Include blood, urine, and consider C. diff if there’s diarrhea.',
        timestamp: 'Yesterday',
      },
      {
        id: 'm3',
        senderId: 'me',
        text: 'Good call. I’ll hold off on broadening until we have more data unless he becomes hypotensive.',
        timestamp: 'Yesterday',
      },
    ],
  },
  {
    ...DOCTOR_DIRECTORY[2],
    lastMessage: 'If imaging is clean, I’d still watch for delayed deficits.',
    messages: [
      {
        id: 'm1',
        senderId: 'doc-3',
        text: 'Jordan — following up on that thunderclap headache consult. Any new neuro findings overnight?',
        timestamp: 'Mon',
      },
      {
        id: 'm2',
        senderId: 'me',
        text: 'Neuro exam remains non-focal. CT angio pending this morning.',
        timestamp: 'Mon',
      },
      {
        id: 'm3',
        senderId: 'doc-3',
        text: 'If imaging is clean, I’d still watch for delayed deficits. Happy to reassess after the CTA.',
        timestamp: 'Mon',
      },
    ],
  },
  {
    ...DOCTOR_DIRECTORY[3],
    lastMessage: 'Let’s retitrate insulin and recheck in 48h.',
    messages: [
      {
        id: 'm1',
        senderId: 'me',
        text: 'Eli, steroid taper patient with glucose swinging 220–340. Keep basal the same or bump?',
        timestamp: 'Sun',
      },
      {
        id: 'm2',
        senderId: 'doc-4',
        text: 'Let’s retitrate insulin and recheck in 48h. I’d raise basal 10–15% while on higher steroid dose.',
        timestamp: 'Sun',
      },
    ],
  },
];
