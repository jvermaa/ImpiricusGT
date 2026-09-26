import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { colors } from '../theme/colors';

type Props = {
  children?: React.ReactNode;
};

const DOT_SPACING = 18;
const DOT_RADIUS = 1.1;

export function DottedGradientBackground({ children }: Props) {
  const { width, height } = useWindowDimensions();

  const svgSize = useMemo(
    () => ({
      width: Math.max(width, 1),
      height: Math.max(height, 1),
    }),
    [width, height],
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.navy, colors.navyMid, colors.gradientBottom]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Svg
        width={svgSize.width}
        height={svgSize.height}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Defs>
          <Pattern
            id="dotGrid"
            x="0"
            y="0"
            width={DOT_SPACING}
            height={DOT_SPACING}
            patternUnits="userSpaceOnUse"
          >
            <Circle
              cx={DOT_SPACING / 2}
              cy={DOT_SPACING / 2}
              r={DOT_RADIUS}
              fill="rgba(255,255,255,0.45)"
            />
          </Pattern>
        </Defs>
        <Rect
          x="0"
          y="0"
          width={svgSize.width}
          height={svgSize.height}
          fill="url(#dotGrid)"
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.navy,
  },
});
