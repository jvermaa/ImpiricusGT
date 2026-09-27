import React from 'react';
import type { SpecialtyIconName } from '../theme/specialtyThemes';
import {
  BrainIcon,
  DropletIcon,
  HandIcon,
  HeartIcon,
  JointIcon,
  LungsIcon,
  MedicalCrossIcon,
  StethoscopeIcon,
  StomachIcon,
} from './NavIcons';

type Props = {
  name: SpecialtyIconName;
  color: string;
  size?: number;
};

const SPECIALTY_ICONS: Record<
  SpecialtyIconName,
  (props: { color: string; size?: number }) => React.ReactElement
> = {
  heart: HeartIcon,
  brain: BrainIcon,
  lungs: LungsIcon,
  droplet: DropletIcon,
  hand: HandIcon,
  joint: JointIcon,
  stomach: StomachIcon,
  stethoscope: StethoscopeIcon,
  cross: MedicalCrossIcon,
};

export function SpecialtyIcon({ name, color, size = 22 }: Props) {
  const Icon = SPECIALTY_ICONS[name] ?? MedicalCrossIcon;
  return <Icon color={color} size={size} />;
}
