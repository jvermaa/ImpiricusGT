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
};

export type DoctorThread = DoctorProfile & {
  lastMessage: string;
  messages: ChatMessage[];
};

export type CurrentDoctor = {
  id: string;
  name: string;
  designation: string;
  initials: string;
};
