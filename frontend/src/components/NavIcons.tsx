import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

type IconProps = {
  color: string;
  size?: number;
};

/** Clipboard / document icon. */
export function PrescriberIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 3.8h5.1L17.2 8v11.2A1.5 1.5 0 0 1 15.7 20.7H8A1.5 1.5 0 0 1 6.5 19.2V5.3A1.5 1.5 0 0 1 8 3.8Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M13.1 3.9V7.5a.9.9 0 0 0 .9.9h3.2"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M9.3 11.5h5.4M9.3 14.6h3.8"
        stroke={color}
        strokeWidth={1.55}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Two overlapping four-pointed sparkles. */
export function TranslatorIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8.5 4.5 9.85 8.4l3.9 1.35-3.9 1.35L8.5 15 7.15 11.1 3.25 9.75l3.9-1.35L8.5 4.5Z"
        fill={color}
      />
      <Path
        d="M16.5 10 17.4 12.7l2.7.95-2.7.95-.9 2.7-.9-2.7-2.7-.95 2.7-.95.9-2.7Z"
        fill={color}
      />
    </Svg>
  );
}

/** Speech bubble with person — Concierge. */
export function ConciergeIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.8 7.2c0-2.25 2.9-4.1 7.2-4.1s7.2 1.85 7.2 4.1v4.5c0 2.25-2.9 4.1-7.2 4.1-.95 0-1.85-.08-2.6-.23L5.6 18.7v-3.15c-.5-.7-.8-1.55-.8-2.45V7.2Z"
        stroke={color}
        strokeWidth={1.55}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={8.4} r={1.45} fill={color} />
      <Path
        d="M9.1 13.3c.45-1.55 1.6-2.35 2.9-2.35s2.45.8 2.9 2.35"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Chat bubbles — peer consult / Iris. */
export function ChatIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.5 6.8c0-1.7 1.7-3.1 4.4-3.1h2.2c2.7 0 4.4 1.4 4.4 3.1v3.2c0 1.7-1.7 3.1-4.4 3.1H8.2L5.2 15.2V12.8C4.75 12.1 4.5 11.3 4.5 10.5V6.8Z"
        stroke={color}
        strokeWidth={1.55}
        strokeLinejoin="round"
      />
      <Path
        d="M11.8 10.8h2.4c2.5 0 4.1 1.25 4.1 2.85v2.4c0 .7-.2 1.35-.6 1.9v1.85l-2.5-1.55h-1c-2.5 0-4.1-1.25-4.1-2.85"
        stroke={color}
        strokeWidth={1.55}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Simple person silhouette. */
export function ProfileIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.2} r={3.3} stroke={color} strokeWidth={1.7} />
      <Path
        d="M5.2 19.2c.7-3.2 3.2-5 6.8-5s6.1 1.8 6.8 5"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Back / chevron left. */
export function ChevronLeftIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5.5 8.5 12 15 18.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Plus for new chat FAB. */
export function PlusIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5v14M5 12h14"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Filter / funnel. */
export function FilterIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 6h16M7 12h10M10 18h4"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Magnifying glass. */
export function SearchIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={1.7} />
      <Path
        d="M16.2 16.2 20 20"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Close X. */
export function CloseIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Send arrow for composer. */
export function SendIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4.2 11.2 19.5 4.5 12.8 19.8l-1.5-6.4-7.1-2.2Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M11.3 13.4 19.5 4.5"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}
