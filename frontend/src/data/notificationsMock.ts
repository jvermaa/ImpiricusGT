export type NotificationType =
  | "samples"
  | "rx_alert"
  | "coverage"
  | "rep_visit"
  | "clinical_update"
  | "access_update"
  | "launch_campaign"
  | "conference"
  | "approved_resources"
  | "patient_savings";

export type NotificationAction = {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "ghost";
};

export type NotificationMessage = {
  id: string;
  senderId: "desk" | "me";
  senderName?: string;
  senderRole?: string;
  text: string;
  timestamp: string;
};

export type NotificationInfoCard = {
  title: string;
  sections: { label: string; value: string }[];
  bullets?: string[];
  linkLabel?: string;
  chips?: string[];
};

export type CampaignChip = {
  id: string;
  label: string;
};

export type SuitablePatient = {
  id: string;
  initials: string;
  name: string;
  condition: string;
  avatarColor: string;
  /** A/B variant for sponsor feedback. */
  cta: "invite" | "notify";
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  sender: string;
  brand: string;
  preview: string;
  body: string;
  actions: NotificationAction[];
  threadId: string;
  unread: number;
  timeAgo: string;
  infoCard: NotificationInfoCard;
  messages: NotificationMessage[];
  /** Deep-link hint for Patient tab (rx alerts). */
  patientLink?: { initials: string; label: string };
  /** Show "Find relevant patients" on the list card (not a chat thread). */
  findSuitablePatients?: boolean;
  /** If false, tapping the card never opens a chat thread. */
  opensChat?: boolean;
  /** Campaign-style chips under the body. */
  campaignChips?: CampaignChip[];
  /** Primary outbound link — list tap opens this instead of chat. */
  linkUrl?: string;
  linkButtonLabel?: string;
  /** Reply-only CTA when there is no link. */
  replyPrompt?: string;
};

export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  { accent: string; label: string }
> = {
  samples: { accent: "#7B61FF", label: "Samples" },
  rx_alert: { accent: "#E07A5F", label: "Rx Alert" },
  coverage: { accent: "#4A90A4", label: "Coverage" },
  rep_visit: { accent: "#D4A017", label: "Rep Visit" },
  clinical_update: { accent: "#5B8C5A", label: "Clinical" },
  access_update: { accent: "#3D7EA6", label: "Access" },
  launch_campaign: { accent: "#8E6BC9", label: "Launch" },
  conference: { accent: "#C45B7A", label: "Conference" },
  approved_resources: { accent: "#6B7FD7", label: "Resources" },
  patient_savings: { accent: "#2E8B7A", label: "Savings" },
};

/** Mock panel for Samples Available (match) patient finder. */
export const SUITABLE_PATIENTS: SuitablePatient[] = [
  {
    id: "p1",
    initials: "A.R.",
    name: "A.R.",
    condition: "HTN · Stage 2",
    avatarColor: "#7B61FF",
    cta: "invite",
  },
  {
    id: "p2",
    initials: "M.K.",
    name: "M.K.",
    condition: "CAD · Statin intolerant",
    avatarColor: "#4A90A4",
    cta: "notify",
  },
  {
    id: "p3",
    initials: "L.S.",
    name: "L.S.",
    condition: "HF · NYHA II",
    avatarColor: "#C45B7A",
    cta: "invite",
  },
  {
    id: "p4",
    initials: "J.T.",
    name: "J.T.",
    condition: "Dyslipidemia",
    avatarColor: "#5B8C5A",
    cta: "notify",
  },
  {
    id: "p5",
    initials: "P.N.",
    name: "P.N.",
    condition: "HTN · Diabetes",
    avatarColor: "#D4A017",
    cta: "invite",
  },
  {
    id: "p6",
    initials: "C.D.",
    name: "C.D.",
    condition: "ASCVD risk high",
    avatarColor: "#E07A5F",
    cta: "notify",
  },
];

const samplesBase = {
  type: "samples" as const,
  title: "Samples Available",
  sender: "Concierge",
  brand: "Cardivex",
  preview:
    "Free Cardivex 10mg samples ready to ship to your office. Tap to request.",
  body: "Free Cardivex 10mg samples are ready to ship to your office. Choose a quantity and confirm shipping details to complete your request.",
  findSuitablePatients: true,
  opensChat: false,
  actions: [
    { id: "req-2", label: "Request 2 boxes", style: "primary" as const },
    { id: "req-4", label: "Request 4 boxes", style: "primary" as const },
    { id: "not-now", label: "Not now", style: "ghost" as const },
  ],
  infoCard: {
    title: "Cardivex 10mg — Sample Request",
    sections: [
      { label: "Quantity", value: "2 or 4 boxes available" },
      { label: "Ship to", value: "Office · 1200 Peachtree St NE, Atlanta, GA" },
      { label: "Signature", value: "E-signature required before ship" },
    ],
  },
  messages: [
    {
      id: "m1",
      senderId: "desk" as const,
      senderName: "Concierge",
      senderRole: "Sample Desk",
      text: "Hi Dr. Hale — Cardivex 10mg samples are allocated for your office this week. Use Find relevant patients to review matches in your panel.",
      timestamp: "10:42 AM",
    },
  ],
};

const NOTIFICATIONS_RAW: AppNotification[] = [
  {
    ...samplesBase,
    id: "n-samples",
    threadId: "thread-samples",
    unread: 2,
    timeAgo: "10m ago",
  },
  {
    id: "n-samples-match",
    type: "clinical_update",
    title: "Clinical Trial: Patients Needed",
    sender: "Trial Desk",
    brand: "Novartis",
    preview: "Novartis • 45-54 Cohort • Dyspnea / Fatigue",
    body: "Enrollment open for a Novartis heart-failure cohort (ages 45–54) with dyspnea and fatigue. Review your panel for high-match patients and notify candidates.",
    threadId: "thread-samples-match",
    unread: 1,
    timeAgo: "25m ago",
    findSuitablePatients: true,
    opensChat: false,
    linkUrl: "https://link.io/novartis-cohort",
    linkButtonLabel: "View trial details",
    actions: [
      { id: "affected", label: "Review cohort", style: "primary" },
      { id: "got-it", label: "Got it", style: "ghost" },
    ],
    infoCard: {
      title: "Novartis HF Cohort — Enrollment",
      sections: [
        { label: "Age band", value: "45–54" },
        { label: "Key symptoms", value: "Dyspnea / Fatigue" },
        { label: "Sponsor", value: "Novartis" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Trial Desk",
        senderRole: "Clinical Ops",
        text: "Hi Dr. Hale — we need patients for a Novartis 45–54 dyspnea/fatigue cohort. Use Find relevant patients to review matches in your panel.",
        timestamp: "10:28 AM",
      },
    ],
  },
  {
    id: "n-rx",
    type: "rx_alert",
    title: "Rx Not Picked Up",
    sender: "Concierge",
    brand: "Glucora",
    preview:
      "Your Rx for patient J.M. (Glucora) hasn't been filled in 5 days. Likely cost barrier.",
    body: "Patient J.M.'s Glucora Rx hasn't been filled in 5 days. Likely cause: $85 copay or prior authorization pending.",
    threadId: "thread-rx",
    unread: 3,
    timeAgo: "1h ago",
    patientLink: { initials: "J.M.", label: "Open in Patient" },
    actions: [
      { id: "copay", label: "Send copay card to patient", style: "primary" },
      { id: "pa", label: "Start PA", style: "primary" },
      { id: "dismiss", label: "Dismiss", style: "ghost" },
    ],
    infoCard: {
      title: "Glucora — Fill Delay",
      sections: [
        { label: "Patient", value: "J.M. (initials only)" },
        { label: "Likely reason", value: "$85 copay · or PA pending" },
        { label: "Days unfilled", value: "5 days" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Concierge",
        senderRole: "Rx Alerts",
        text: "Pharmacy reports Glucora for J.M. still unfilled after 5 days. Most common blockers: high copay ($85) or PA not started. Want me to send a copay card or kick off PA?",
        timestamp: "9:18 AM",
      },
    ],
  },
  {
    id: "n-coverage",
    type: "coverage",
    title: "Coverage Update",
    sender: "Access & Coverage",
    brand: "Cardivex",
    preview:
      "Cardivex is now preferred on BlueCross GA commercial. No PA needed.",
    body: "Cardivex is now preferred on BlueCross GA commercial plans. No prior authorization required.",
    threadId: "thread-coverage",
    unread: 1,
    timeAgo: "Yesterday",
    actions: [
      { id: "affected", label: "Show my affected patients", style: "primary" },
      { id: "got-it", label: "Got it", style: "ghost" },
    ],
    infoCard: {
      title: "BlueCross GA · Commercial",
      sections: [
        { label: "Payer", value: "BlueCross BlueShield of Georgia" },
        { label: "Tier", value: "Preferred brand" },
        { label: "Effective", value: "March 1, 2026" },
        { label: "Copay range", value: "$10–$35 typical" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Access Desk",
        senderRole: "Coverage",
        text: "Good news — Cardivex moved to preferred on BlueCross GA commercial. No PA needed going forward. I can surface which of your patients this may help.",
        timestamp: "Yesterday",
      },
    ],
  },
  {
    id: "n-access",
    type: "access_update",
    title: "Access update",
    sender: "Access Desk",
    brand: "Cardivex",
    preview:
      "91% of Medicare Part D patients have coverage for CARDIVEX®. Check local coverage.",
    body: "Hi Dr. Patel, 91% of Medicare Part D patients have coverage for CARDIVEX®. Check local coverage: https://link.io/A1",
    threadId: "thread-access",
    unread: 1,
    timeAgo: "4d ago",
    opensChat: false,
    actions: [],
    campaignChips: [
      { id: "rep", label: "REP" },
      { id: "samples", label: "SAMPLES" },
    ],
    linkUrl: "https://link.io/A1",
    linkButtonLabel: "Check local coverage",
    infoCard: {
      title: "CARDIVEX® · Medicare Part D",
      sections: [
        { label: "Coverage", value: "91% of Part D patients" },
        { label: "Action", value: "Review local formulary status" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Access Desk",
        senderRole: "Coverage",
        text: "Hi Dr. Patel, 91% of Medicare Part D patients have coverage for CARDIVEX®. Tap below to check local coverage.",
        timestamp: "4d ago",
      },
    ],
  },
  {
    id: "n-launch",
    type: "launch_campaign",
    title: "Launch campaign",
    sender: "Brand Desk",
    brand: "Glucora",
    preview:
      "GLUCORA® is now FDA-approved for adults with T2D and CKD. View prescribing info.",
    body: "Hi Dr. Patel, GLUCORA® is now FDA-approved for adults with T2D and CKD. View prescribing info: https://link.io/B2",
    threadId: "thread-launch",
    unread: 1,
    timeAgo: "5d ago",
    opensChat: false,
    actions: [],
    campaignChips: [
      { id: "info", label: "INFO" },
      { id: "rep", label: "REP" },
    ],
    linkUrl: "https://link.io/B2",
    linkButtonLabel: "View prescribing info",
    infoCard: {
      title: "GLUCORA® · New Indication",
      sections: [
        { label: "Indication", value: "Adults with T2D and CKD" },
        { label: "Status", value: "FDA-approved" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Brand Desk",
        senderRole: "Launch",
        text: "Hi Dr. Patel, GLUCORA® is now FDA-approved for adults with T2D and CKD. View prescribing info below.",
        timestamp: "5d ago",
      },
    ],
  },
  {
    id: "n-conference",
    type: "conference",
    title: "Conference support",
    sender: "Medical Affairs",
    brand: "Lumaderm",
    preview:
      "New LUMADERM® Phase 3 data was presented at AAD this week. See the 1-page summary.",
    body: "Hi Dr. Patel, new LUMADERM® Phase 3 data was presented at AAD this week. See the 1-page summary: https://link.io/C3",
    threadId: "thread-conference",
    unread: 0,
    timeAgo: "1w ago",
    opensChat: false,
    actions: [],
    campaignChips: [
      { id: "summary", label: "SUMMARY" },
      { id: "rep", label: "REP" },
    ],
    linkUrl: "https://link.io/C3",
    linkButtonLabel: "See 1-page summary",
    infoCard: {
      title: "LUMADERM® · AAD Phase 3",
      sections: [
        { label: "Meeting", value: "AAD · this week" },
        { label: "Asset", value: "1-page clinical summary" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Medical Affairs",
        senderRole: "Conference",
        text: "Hi Dr. Patel, new LUMADERM® Phase 3 data was presented at AAD this week. See the 1-page summary below.",
        timestamp: "1w ago",
      },
    ],
  },
  {
    id: "n-approved-samples",
    type: "approved_resources",
    title: "Approved resources (samples)",
    sender: "Sample Desk",
    brand: "Cardivex",
    preview:
      "CARDIVEX® samples are available for your office. Reply SAMPLES to request.",
    body: "Hi Dr. Patel, CARDIVEX® samples are available for your office. Reply SAMPLES to request.",
    threadId: "thread-approved-samples",
    unread: 1,
    timeAgo: "1w ago",
    opensChat: false,
    actions: [],
    campaignChips: [
      { id: "samples", label: "SAMPLES" },
      { id: "rep", label: "REP" },
    ],
    replyPrompt: "SAMPLES",
    infoCard: {
      title: "CARDIVEX® · Office Samples",
      sections: [
        { label: "How to request", value: "Reply SAMPLES (no link)" },
        { label: "Note", value: "Fewer links → higher engagement" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Sample Desk",
        senderRole: "Resources",
        text: "Hi Dr. Patel, CARDIVEX® samples are available for your office. Reply SAMPLES to request — no link needed.",
        timestamp: "1w ago",
      },
    ],
  },
  {
    id: "n-savings",
    type: "patient_savings",
    title: "Patient savings",
    sender: "Patient Support",
    brand: "Glucora",
    preview:
      "Eligible patients may pay as little as $10 for GLUCORA®. Share the savings card.",
    body: "Hi Dr. Patel, eligible patients may pay as little as $10 for GLUCORA®. Share the savings card: https://link.io/E5",
    threadId: "thread-savings",
    unread: 0,
    timeAgo: "2w ago",
    opensChat: false,
    actions: [],
    campaignChips: [
      { id: "send", label: "SEND TO PATIENT" },
      { id: "rep", label: "REP" },
    ],
    linkUrl: "https://link.io/E5",
    linkButtonLabel: "Share savings card",
    infoCard: {
      title: "GLUCORA® · Patient Savings",
      sections: [
        { label: "Copay", value: "As little as $10 for eligible patients" },
        { label: "Asset", value: "Savings card · link.io/E5" },
      ],
    },
    messages: [
      {
        id: "m1",
        senderId: "desk",
        senderName: "Patient Support",
        senderRole: "Savings",
        text: "Hi Dr. Patel, eligible patients may pay as little as $10 for GLUCORA®. Share the savings card below.",
        timestamp: "2w ago",
      },
    ],
  },
];

/** Every inbox card is cohort-style: Find relevant patients, never desk chat. */
export const NOTIFICATIONS: AppNotification[] = NOTIFICATIONS_RAW.map((n) => ({
  ...n,
  findSuitablePatients: true,
  opensChat: false,
}));
