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
