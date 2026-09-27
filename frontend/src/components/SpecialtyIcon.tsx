import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { SpecialtyIconName } from '../theme/specialtyThemes';

type Props = {
  name: SpecialtyIconName;
  color: string;
  size?: number;
};

export function SpecialtyIcon({ name, color, size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'heart' ? (
        <Path
          d="M12 19.2s-6.4-3.9-6.4-8.1A3.5 3.5 0 0 1 12 8.6a3.5 3.5 0 0 1 6.4 2.5c0 4.2-6.4 8.1-6.4 8.1Z"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'brain' ? (
        <>
          <Path
            d="M9.2 6.2A3 3 0 0 0 6 9c-1.4.2-2.4 1.4-2.4 2.8 0 1 .5 1.8 1.2 2.3-.2.5-.3 1-.3 1.6 0 1.7 1.4 3 3.2 3.3"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <Path
            d="M14.8 6.2A3 3 0 0 1 18 9c1.4.2 2.4 1.4 2.4 2.8 0 1-.5 1.8-1.2 2.3.2.5.3 1 .3 1.6 0 1.7-1.4 3-3.2 3.3"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <Path d="M12 6.2v12.4" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
        </>
      ) : null}
      {name === 'lungs' ? (
        <>
          <Path
            d="M12 4.5v6.2M9.4 8.2C7 8.6 5 10.6 5 13.4 5 16.5 7.2 19 10 19H12"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <Path
            d="M14.6 8.2C17 8.6 19 10.6 19 13.4 19 16.5 16.8 19 14 19H12"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </>
      ) : null}
      {name === 'droplet' ? (
        <Path
          d="M12 4.2s5.2 5.4 5.2 8.6A5.2 5.2 0 0 1 12 18a5.2 5.2 0 0 1-5.2-5.2C6.8 9.6 12 4.2 12 4.2Z"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      ) : null}
      {name === 'hand' ? (
        <>
          <Path
            d="M8.2 11.2V6.6a1.2 1.2 0 0 1 2.4 0V11M10.6 10.2V5.4a1.2 1.2 0 0 1 2.4 0v5.2M13 10V6.2a1.2 1.2 0 0 1 2.4 0V12"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <Path
            d="M8.2 11.4c-.8.6-2 2-2 3.8 0 2.6 2.2 4.6 5.8 4.6 3.2 0 5.8-1.6 6.2-4.2l.4-2.4a1.3 1.3 0 0 0-2.5-.6L15.4 14"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {name === 'joint' ? (
        <>
          <Circle cx={7.2} cy={12} r={2.4} stroke={color} strokeWidth={1.5} />
          <Circle cx={16.8} cy={12} r={2.4} stroke={color} strokeWidth={1.5} />
          <Path d="M9.6 12h4.8" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        </>
      ) : null}
      {name === 'stomach' ? (
        <Path
          d="M9 5.2c.4 1.8.2 3.2-.6 4.4C7.2 11.2 7 12.8 8 15.2c.8 2 2.6 3.6 5.2 3.6 2.8 0 4.6-1.8 4.2-4.2-.3-1.6-1.2-2.6-1.4-4 .-.8 0-1.6-.4-2.4-1.4"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ) : null}
      {name === 'stethoscope' ? (
        <>
          <Path
            d="M6.2 5.2v4.2a3.6 3.6 0 0 0 7.2 0V5.2M8 5.2v1.2M11.6 5.2v1.2"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <Path
            d="M13.4 12.8c0 2.4 1.6 4.2 4 4.2 2.2 0 3.4-1.4 3.4-3.2"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <Circle cx={17.4} cy={10.4} r={2.1} stroke={color} strokeWidth={1.5} />
        </>
      ) : null}
      {name === 'cross' ? (
        <>
          <Rect x={3.5} y={3.5} width={17} height={17} rx={4} stroke={color} strokeWidth={1.5} />
          <Path d="M12 8v8M8 12h8" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        </>
      ) : null}
    </Svg>
  );
}
