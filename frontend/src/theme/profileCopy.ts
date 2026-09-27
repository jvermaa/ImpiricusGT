/** Fixed wording for the doctor profile. Not stored in the database. */
export const profileCopy = {
  demoBadge: 'Demo profile',
  demoTitle: 'Demo profile',
  demoBody:
    'This profile uses synthetic clinic data. Names, messages, patients, and referrals are not real people.',
  consultsOn: 'Other doctors can message you and see you in referral suggestions.',
  consultsOff: "You're hidden from the consult list and referral suggestions.",
  sharingOn: "Your consented patients' de-identified cases help other doctors.",
  sharingOff: 'Your patients are excluded from similar-case search.',
  addBio: 'Add a short bio',
  bioPlaceholder: 'What should other doctors know about your practice?',
  emptyDirectory: 'No doctors match',
  clearFilters: 'Clear filters',
  noPatients: 'No patients on your panel.',
  noReferrals: 'No referrals in this list.',
  shareHint: 'A peer can scan this for the doctor key and name.',
} as const;
