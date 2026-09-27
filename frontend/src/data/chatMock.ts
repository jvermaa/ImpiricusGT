export type DoctorProfile = {
  id: string;
  name: string;
  designation: string;
  specialty: string;
  specializations: string[];
  degrees: string[];
  address: string;
  distanceKm: number;
  initials: string;
  avatarColor: string;
  subspecialtyFocus?: string;
};

/** Full directory for starting new peer chats when the API is unavailable. */
export const DOCTOR_DIRECTORY: DoctorProfile[] = [
  {
    id: 'doc-1',
    name: 'Dr. Amira Patel',
    designation: 'Cardiologist',
    specialty: 'Cardiology',
    specializations: ['Cardiology', 'Heart Failure'],
    degrees: ['MD', 'FACC'],
    address: '1200 Peachtree St NE, Atlanta, GA',
    distanceKm: 1.8,
    initials: 'AP',
    avatarColor: '#7B61FF',
  },
  {
    id: 'doc-2',
    name: 'Dr. Marcus Chen',
    designation: 'Infectious Disease',
    specialty: 'Infectious Disease',
    specializations: ['Infectious Disease', 'Internal Medicine'],
    degrees: ['MD', 'MPH'],
    address: '915 Howell Mill Rd NW, Atlanta, GA',
    distanceKm: 3.2,
    initials: 'MC',
    avatarColor: '#4A90A4',
  },
  {
    id: 'doc-3',
    name: 'Dr. Sofia Reyes',
    designation: 'Neurologist',
    specialty: 'Neurology',
    specializations: ['Neurology', 'Movement Disorders'],
    degrees: ['MD', 'PhD'],
    address: '4330 Northside Pkwy NW, Atlanta, GA',
    distanceKm: 4.9,
    initials: 'SR',
    avatarColor: '#C45B7A',
  },
  {
    id: 'doc-4',
    name: 'Dr. Eli Nakamura',
    designation: 'Endocrinologist',
    specialty: 'Endocrinology',
    specializations: ['Endocrinology', 'Diabetes Care'],
    degrees: ['MD'],
    address: '2000 Century Blvd NE, Atlanta, GA',
    distanceKm: 6.1,
    initials: 'EN',
    avatarColor: '#5B8C5A',
  },
  {
    id: 'doc-5',
    name: 'Dr. Priya Nair',
    designation: 'Pulmonologist',
    specialty: 'Pulmonology',
    specializations: ['Pulmonology', 'Critical Care'],
    degrees: ['MD', 'FCCP'],
    address: '3200 Piedmont Rd NE, Atlanta, GA',
    distanceKm: 2.6,
    initials: 'PN',
    avatarColor: '#6B7FD7',
  },
  {
    id: 'doc-6',
    name: 'Dr. James Okonkwo',
    designation: 'Nephrologist',
    specialty: 'Nephrology',
    specializations: ['Nephrology', 'Hypertension'],
    degrees: ['MD'],
    address: '95 Collier Rd NW, Atlanta, GA',
    distanceKm: 7.4,
    initials: 'JO',
    avatarColor: '#D4A017',
  },
  {
    id: 'doc-7',
    name: 'Dr. Lena Vogt',
    designation: 'Rheumatologist',
    specialty: 'Rheumatology',
    specializations: ['Rheumatology', 'Autoimmune Disease'],
    degrees: ['MD', 'MS'],
    address: '1745 Peachtree St NW, Atlanta, GA',
    distanceKm: 5.5,
    initials: 'LV',
    avatarColor: '#9B59B6',
  },
  {
    id: 'doc-8',
    name: 'Dr. Hassan Al-Rashid',
    designation: 'Gastroenterologist',
    specialty: 'Gastroenterology',
    specializations: ['Gastroenterology', 'Hepatology'],
    degrees: ['MD'],
    address: '5670 Roswell Rd NE, Atlanta, GA',
    distanceKm: 8.1,
    initials: 'HA',
    avatarColor: '#2E8B7A',
  },
  {
    id: 'doc-9',
    name: 'Dr. Claire Dubois',
    designation: 'Oncologist',
    specialty: 'Oncology',
    specializations: ['Oncology', 'Clinical Trials'],
    degrees: ['MD', 'FACP'],
    address: '1365 Clifton Rd NE, Atlanta, GA',
    distanceKm: 9.7,
    initials: 'CD',
    avatarColor: '#E07A5F',
  },
  {
    id: 'doc-10',
    name: 'Dr. Wei Zhang',
    designation: 'Cardiologist',
    specialty: 'Cardiology',
    specializations: ['Cardiology', 'Preventive Cardiology'],
    degrees: ['MD', 'MSc'],
    address: '550 Peachtree St NE, Atlanta, GA',
    distanceKm: 2.1,
    initials: 'WZ',
    avatarColor: '#3D5A80',
  },
];

export const SPECIALTIES = [
  'All',
  ...Array.from(new Set(DOCTOR_DIRECTORY.map((d) => d.specialty))).sort(),
];

/** Signed-in doctor for the prototype chat list. Not loaded from the API. */
export const DEMO_CURRENT_DOCTOR = {
  id: 'me',
  name: 'Dr. Aisha Reed',
  designation: 'Neurologist',
  initials: 'AR',
};

const peer = (id: string) => {
  const doctor = DOCTOR_DIRECTORY.find((entry) => entry.id === id);
  if (!doctor) throw new Error(`Missing demo doctor ${id}`);
  return doctor;
};

/** Prototype consults. Messages stay on this device; nothing is sent to the API. */
export const DEMO_THREADS = [
  {
    ...peer('doc-1'),
    threadId: 'demo-1',
    lastMessage: 'ECG is normal. I would not hold the migraine prevention plan.',
    messages: [
      {
        id: 'demo-1-a',
        senderId: 'doc-1',
        text: 'Aisha — palpitations only during the migraine. Exam is clean. Do you still want them on the preventive?',
        timestamp: 'Sep 24, 9:05 AM',
      },
      {
        id: 'demo-1-b',
        senderId: 'me',
        text: 'Yes. If the palpitations stay tied to the attack, I would not stop prevention.',
        timestamp: 'Sep 24, 9:12 AM',
      },
      {
        id: 'demo-1-c',
        senderId: 'doc-1',
        text: 'ECG is normal. I would not hold the migraine prevention plan.',
        timestamp: 'Sep 24, 9:20 AM',
      },
    ],
  },
  {
    ...peer('doc-8'),
    threadId: 'demo-2',
    lastMessage: 'That timing fits the medicine. I would switch it before a GI workup.',
    messages: [
      {
        id: 'demo-2-a',
        senderId: 'me',
        text: 'Hassan — daily nausea after starting a migraine preventive. No weight loss or bleeding. Medication effect, or something you should see?',
        timestamp: 'Sep 25, 2:05 PM',
      },
      {
        id: 'demo-2-b',
        senderId: 'doc-8',
        text: 'That timing fits the medicine. I would switch it before a GI workup.',
        timestamp: 'Sep 25, 2:18 PM',
      },
    ],
  },
  {
    ...peer('doc-3'),
    threadId: 'demo-3',
    lastMessage: 'Agreed. I would not start an antiseizure medicine on this description.',
    messages: [
      {
        id: 'demo-3-a',
        senderId: 'doc-3',
        text: 'Brief visual change, then a headache. The family is asking if this could be a seizure rather than migraine aura.',
        timestamp: 'Sep 26, 8:40 AM',
      },
      {
        id: 'demo-3-b',
        senderId: 'me',
        text: 'The visual change builds over minutes and the headache follows. That fits aura better than a seizure for me.',
        timestamp: 'Sep 26, 8:47 AM',
      },
      {
        id: 'demo-3-c',
        senderId: 'doc-3',
        text: 'Agreed. I would not start an antiseizure medicine on this description.',
        timestamp: 'Sep 26, 8:55 AM',
      },
    ],
  },
  {
    ...peer('doc-5'),
    threadId: 'demo-4',
    lastMessage: 'I can see them this week if the cough is still worse lying down.',
    messages: [
      {
        id: 'demo-4-a',
        senderId: 'me',
        text: 'Priya — cough is worse lying down, three weeks, no fever. Migraine patient, otherwise well. Worth a chest film?',
        timestamp: 'Sep 26, 4:10 PM',
      },
      {
        id: 'demo-4-b',
        senderId: 'doc-5',
        text: 'I can see them this week if the cough is still worse lying down.',
        timestamp: 'Sep 26, 4:22 PM',
      },
    ],
  },
];
