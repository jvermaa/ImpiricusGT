import type { DoctorProfile } from './chat';

export type ReferralUrgency = 'routine' | 'soon' | 'urgent';
export type ReferralStatus = 'sent' | 'accepted' | 'declined' | 'completed' | 'cancelled';

export type ReferralMessage = {
  message_key: string;
  referral_key: string;
  sender_doctor_key: string;
  text: string;
  timestamp: string;
};

export type ReferralSummary = {
  referral_key: string;
  from_doctor_key: string;
  to_doctor_key: string;
  patient_key: string;
  patient_label: string | null;
  status: ReferralStatus;
  urgency: ReferralUrgency;
  reason: string;
  outcome: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string;
  patient_visible: boolean;
};

export type HandoffSummary = {
  patient_key: string;
  patient_display_label: string;
  age: number;
  sex_for_clinical_context: string;
  state: string;
  preferred_language: string;
  doctor_key: string;
  status: string;
  source: string;
  symptoms: Array<{ name: string; duration: string; frequency: string; trigger: string; onset: string }>;
  alcohol_use: string;
  smoking_status: string;
  pregnancy_status: string;
  immune_status: string;
  relevant_medical_history: string;
  family_medical_history: string;
  current_medications: string;
  lab_results: string;
  allergy_status: string;
  diagnoses: Array<{ label: string; code: string; status: string }>;
  allergies: Array<{ substance: string; reaction: string; status: string }>;
  active_prescriptions: Array<{ generic_medication: string; strength: string; status: string }>;
  labs: Array<{ test_name: string; value: number; unit: string; result_year: number; flag: string }>;
  encounters: Array<{
    encounter_key: string;
    visit_date: string;
    diagnosis: string;
    summary: string;
    symptoms: Array<{ name: string; duration: string; frequency: string; trigger: string; onset: string }>;
    current_medications: string;
    alcohol_use: string;
    smoking_status: string;
    pregnancy_status: string;
    immune_status: string;
    lab_results: string;
  }>;
  followups_pending_approval: string[];
};

export type ReferralDetail = {
  referral: ReferralSummary;
  referring_doctor: DoctorProfile;
  receiving_doctor: DoctorProfile;
  patient_visible: boolean;
  patient_handoff: HandoffSummary | null;
  messages: ReferralMessage[];
};

export type ReferralDirectoryEntry = {
  provider: DoctorProfile & {
    credentials: string;
    subspecialtyFocus: string;
    practiceType: string;
    state: string;
    yearsInPractice: number;
    languages: string[];
    organization: string;
  };
  score: number;
  reasons: string[];
};
