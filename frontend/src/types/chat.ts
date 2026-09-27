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
  credentials?: string;
  subspecialtyFocus?: string;
  practiceType?: string;
  state?: string;
  yearsInPractice?: number;
  languages?: string[];
  organization?: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  status?: 'pending' | 'failed' | 'saved';
};

export type DoctorThread = DoctorProfile & {
  /** Consult thread id from the API. Profile requests use `id` (the peer doctor key). */
  threadId: string;
  lastMessage: string;
  messages: ChatMessage[];
};

export type CurrentDoctor = {
  id: string;
  name: string;
  designation: string;
  initials: string;
};
