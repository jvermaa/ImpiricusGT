import React from 'react';
import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'expo-symbols';

export type IconProps = {
  color: string;
  size?: number;
};

type SymbolNames = {
  ios: SFSymbol;
  material: string;
};

function AppSymbol({
  ios,
  material,
  color,
  size = 24,
}: SymbolNames & IconProps) {
  return (
    <SymbolView
      name={
        {
          ios,
          android: material,
          web: material,
        } as React.ComponentProps<typeof SymbolView>['name']
      }
      tintColor={color}
      size={size}
      weight="regular"
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
    />
  );
}

/** Patient / clipboard document icon. */
export function PatientIcon({ color, size = 24 }: IconProps) {
  return <AppSymbol ios="doc.text" material="description" color={color} size={size} />;
}

/** Bell for notifications. */
export function NotificationIcon({ color, size = 24 }: IconProps) {
  return <AppSymbol ios="bell" material="notifications" color={color} size={size} />;
}

/** Chat bubbles — doctor-to-doctor. */
export function ChatIcon({ color, size = 24 }: IconProps) {
  return (
    <AppSymbol
      ios="bubble.left.and.bubble.right"
      material="chat"
      color={color}
      size={size}
    />
  );
}

/** Simple person silhouette. */
export function ProfileIcon({ color, size = 24 }: IconProps) {
  return <AppSymbol ios="person" material="person" color={color} size={size} />;
}

/** Back / chevron left. */
export function ChevronLeftIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="chevron.left" material="chevron_left" color={color} size={size} />;
}

/** Plus for new chat FAB. */
export function PlusIcon({ color, size = 24 }: IconProps) {
  return <AppSymbol ios="plus" material="add" color={color} size={size} />;
}

/** Filter / funnel. */
export function FilterIcon({ color, size = 22 }: IconProps) {
  return (
    <AppSymbol
      ios="line.3.horizontal.decrease"
      material="filter_list"
      color={color}
      size={size}
    />
  );
}

/** Magnifying glass. */
export function SearchIcon({ color, size = 18 }: IconProps) {
  return <AppSymbol ios="magnifyingglass" material="search" color={color} size={size} />;
}

/** Close X. */
export function CloseIcon({ color, size = 20 }: IconProps) {
  return <AppSymbol ios="xmark" material="close" color={color} size={size} />;
}

/** Send arrow for composer. */
export function SendIcon({ color, size = 20 }: IconProps) {
  return <AppSymbol ios="paperplane.fill" material="send" color={color} size={size} />;
}

/** Document / PDF export. */
export function PdfIcon({ color, size = 18 }: IconProps) {
  return <AppSymbol ios="doc.richtext" material="picture_as_pdf" color={color} size={size} />;
}

/** Pencil for edit. */
export function EditIcon({ color, size = 18 }: IconProps) {
  return <AppSymbol ios="pencil" material="edit" color={color} size={size} />;
}

/** Calendar with plus for add visit. */
export function AddVisitIcon({ color, size = 18 }: IconProps) {
  return (
    <AppSymbol ios="calendar.badge.plus" material="event" color={color} size={size} />
  );
}

/** Person + arrow for ask/refer HCP. */
export function ReferHcpIcon({ color, size = 18 }: IconProps) {
  return (
    <AppSymbol ios="person.badge.plus" material="person_add" color={color} size={size} />
  );
}

/** Share / upload. */
export function ShareIcon({ color, size = 20 }: IconProps) {
  return <AppSymbol ios="square.and.arrow.up" material="ios_share" color={color} size={size} />;
}

/** Sliders / tune. */
export function SlidersIcon({ color, size = 20 }: IconProps) {
  return <AppSymbol ios="slider.horizontal.3" material="tune" color={color} size={size} />;
}

/** Specialty: heart. */
export function HeartIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="heart.fill" material="favorite" color={color} size={size} />;
}

/** Specialty: brain. */
export function BrainIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="brain.head.profile" material="psychology" color={color} size={size} />;
}

/** Specialty: lungs. */
export function LungsIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="lungs.fill" material="air" color={color} size={size} />;
}

/** Specialty: droplet. */
export function DropletIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="drop.fill" material="water_drop" color={color} size={size} />;
}

/** Specialty: hand. */
export function HandIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="hand.raised.fill" material="back_hand" color={color} size={size} />;
}

/** Specialty: joint / bone. */
export function JointIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="figure.walk" material="accessibility" color={color} size={size} />;
}

/** Specialty: stomach / digestion. */
export function StomachIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="fork.knife" material="restaurant" color={color} size={size} />;
}

/** Specialty: stethoscope. */
export function StethoscopeIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="stethoscope" material="health_and_safety" color={color} size={size} />;
}

/** Specialty: medical cross. */
export function MedicalCrossIcon({ color, size = 22 }: IconProps) {
  return <AppSymbol ios="cross.case.fill" material="medical_services" color={color} size={size} />;
}
