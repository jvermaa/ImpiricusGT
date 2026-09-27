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
