import React from 'react';
import { SymbolView } from 'expo-symbols';

type IconProps = {
  color: string;
  size?: number;
};

type AppSymbolName =
  | 'patient'
  | 'notification'
  | 'chat'
  | 'profile'
  | 'back'
  | 'plus'
  | 'filter'
  | 'search'
  | 'close'
  | 'send'
  | 'pdf'
  | 'edit'
  | 'addVisit';

const SYMBOL_NAMES = {
  patient: { ios: 'doc.text', android: 'description', web: 'description' },
  notification: { ios: 'bell', android: 'notifications', web: 'notifications' },
  chat: { ios: 'bubble.left.and.bubble.right', android: 'forum', web: 'forum' },
  profile: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  back: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  filter: { ios: 'line.3.horizontal.decrease', android: 'filter_list', web: 'filter_list' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  send: { ios: 'paperplane.fill', android: 'send', web: 'send' },
  pdf: { ios: 'doc.richtext', android: 'picture_as_pdf', web: 'picture_as_pdf' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  addVisit: { ios: 'calendar.badge.plus', android: 'event', web: 'event' },
} as const;

function AppSymbol({ name, color, size = 24 }: IconProps & { name: AppSymbolName }) {
  return (
    <SymbolView
      name={SYMBOL_NAMES[name]}
      tintColor={color}
      size={size}
      type="hierarchical"
    />
  );
}

/** Patient / record document icon. */
export function PatientIcon(props: IconProps) {
  return <AppSymbol name="patient" {...props} />;
}

/** Bell for notifications. */
export function NotificationIcon(props: IconProps) {
  return <AppSymbol name="notification" {...props} />;
}

/** Chat bubbles — doctor-to-doctor. */
export function ChatIcon(props: IconProps) {
  return <AppSymbol name="chat" {...props} />;
}

/** Person profile. */
export function ProfileIcon(props: IconProps) {
  return <AppSymbol name="profile" {...props} />;
}

/** Back / chevron left. */
export function ChevronLeftIcon(props: IconProps) {
  return <AppSymbol name="back" {...props} />;
}

/** Plus for new chat FAB. */
export function PlusIcon(props: IconProps) {
  return <AppSymbol name="plus" {...props} />;
}

/** Filter / funnel. */
export function FilterIcon(props: IconProps) {
  return <AppSymbol name="filter" {...props} />;
}

/** Magnifying glass. */
export function SearchIcon(props: IconProps) {
  return <AppSymbol name="search" {...props} />;
}

/** Close X. */
export function CloseIcon(props: IconProps) {
  return <AppSymbol name="close" {...props} />;
}

/** Send arrow for composer. */
export function SendIcon(props: IconProps) {
  return <AppSymbol name="send" {...props} />;
}

/** Document / PDF export. */
export function PdfIcon({ size = 18, ...props }: IconProps) {
  return <AppSymbol name="pdf" size={size} {...props} />;
}

/** Pencil for edit. */
export function EditIcon({ size = 18, ...props }: IconProps) {
  return <AppSymbol name="edit" size={size} {...props} />;
}

/** Calendar with plus for add visit. */
export function AddVisitIcon({ size = 18, ...props }: IconProps) {
  return <AppSymbol name="addVisit" size={size} {...props} />;
}
