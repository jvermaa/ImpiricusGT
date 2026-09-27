import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, G, Path, Pattern, Rect, SvgUri } from 'react-native-svg';
import { colors } from '../theme/colors';

export type PageBackgroundVariant = 'patient' | 'chat' | 'notification' | 'profile';

type Props = {
  children?: React.ReactNode;
  variant?: PageBackgroundVariant;
};

const DOT_SPACING = 18;
const BACKGROUNDS: Record<PageBackgroundVariant, {
  colors: [string, string, string];
  seed: string;
  illustration: 'shapes' | 'notionists';
  artBackground: string;
  shapes: [string, string, string];
  dots: [string, string, string];
}> = {
  patient: {
    colors: ['#E5B8FF', '#D79BF7', '#C98CF0'],
    seed: 'patient-page-art',
    illustration: 'shapes',
    artBackground: 'f4e1ff',
    shapes: ['ff7b72', '9b7ef5', '39b7a6'],
    dots: ['#F17C8A', '#8D79E6', '#36AFA2'],
  },
  chat: {
    colors: ['#A9D5FF', '#7DBBFA', '#D8ECFF'],
    seed: 'peer-chat-art',
    illustration: 'notionists',
    artBackground: 'dceeff',
    shapes: ['39a7df', '8e78ee', 'ff8b79'],
    dots: ['#53A8D1', '#8874D6', '#E68191'],
  },
  notification: {
    colors: ['#FFF1C9', '#FFE1DF', '#F2E8FF'],
    seed: 'clinical-updates-art',
    illustration: 'shapes',
    artBackground: 'fff0d0',
    shapes: ['f18b6d', 'f2bd4b', '58b9a5'],
    dots: ['#E9A24D', '#E77F83', '#9580D8'],
  },
  profile: {
    colors: ['#DDF7E9', '#DDF2FF', '#F0E8FF'],
    seed: 'clinician-profile-art',
    illustration: 'shapes',
    artBackground: 'e7f7ed',
    shapes: ['49b88c', '4caed0', 'a184e8'],
    dots: ['#55AD86', '#4DA7C7', '#9278D1'],
  },
};

export function DottedGradientBackground({ children, variant = 'notification' }: Props) {
  const { width, height } = useWindowDimensions();
  const background = BACKGROUNDS[variant];
  const artworkUri = background.illustration === 'notionists'
    ? `https://api.dicebear.com/10.x/notionists/svg?seed=${background.seed}&backgroundColor=${background.artBackground}&radius=50`
    : `https://api.dicebear.com/10.x/shapes/svg?seed=${background.seed}&backgroundColor=${background.artBackground}&shape1Color=${background.shapes[0]}&shape2Color=${background.shapes[1]}&shape3Color=${background.shapes[2]}&radius=50`;

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
        colors={background.colors}
        locations={[0, 0.52, 1]}
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
            width={DOT_SPACING * 2}
            height={DOT_SPACING * 2}
            patternUnits="userSpaceOnUse"
          >
            <Circle
              cx={DOT_SPACING / 2}
              cy={DOT_SPACING / 2}
              r={2.2}
              fill={background.dots[0]}
              opacity={0.24}
            />
            <Circle
              cx={DOT_SPACING * 1.5}
              cy={DOT_SPACING * 1.5}
              r={1.8}
              fill={background.dots[1]}
              opacity={0.22}
            />
            <Rect
              x={DOT_SPACING + 4}
              y={4}
              width={4}
              height={4}
              rx={1}
              fill={background.dots[2]}
              opacity={0.22}
              transform={`rotate(45 ${DOT_SPACING + 6} 6)`}
            />
          </Pattern>
          {variant === 'patient' ? (
            <Pattern
              id="patientMedicalPattern"
              x="0"
              y="0"
              width={300}
              height={280}
              patternUnits="userSpaceOnUse"
            >
              <G opacity={0.53}>
                <G transform="rotate(-16 48 76)">
                  <Rect x="20" y="52" width="54" height="46" rx="11" fill="#FF777E" stroke="#8B51C5" strokeWidth="3" />
                  <Rect x="36" y="42" width="22" height="13" rx="5" fill="#FFD080" stroke="#8B51C5" strokeWidth="3" />
                  <Rect x="42" y="61" width="10" height="28" rx="2" fill="#FFFFFF" />
                  <Rect x="33" y="70" width="28" height="10" rx="2" fill="#FFFFFF" />
                </G>

                <G transform="rotate(43 229 42)">
                  <Rect x="202" y="32" width="54" height="21" rx="10.5" fill="#FFFFFF" stroke="#8B51C5" strokeWidth="3" />
                  <Path d="M212.5 32h16v21h-16a10.5 10.5 0 0 1 0-21Z" fill="#FF8F9B" />
                  <Path d="M228.5 32v21" stroke="#8B51C5" strokeWidth="2" />
                </G>

                <G transform="rotate(27 131 69)">
                  <Rect x="101" y="63" width="60" height="13" rx="5" fill="#E9FCFF" stroke="#8B51C5" strokeWidth="3" />
                  <Path d="M113 64v11M123 64v7M133 64v11M143 64v7" stroke="#59B8D0" strokeWidth="2" />
                  <Path d="M161 69h13l9-5M161 69h13l9 5M99 58v23" fill="none" stroke="#8B51C5" strokeWidth="3" strokeLinecap="round" />
                </G>

                <G transform="rotate(-12 119 120)">
                  <Path d="M119 137c-8-7-20-15-20-25 0-11 14-15 20-3 7-12 21-8 21 3 0 10-13 19-21 25Z" fill="#FF8F9B" stroke="#8B51C5" strokeWidth="3" strokeLinejoin="round" />
                  <Path d="M104 115h9l4-7 5 14 5-7h6" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </G>

                <G transform="rotate(-31 150 176)">
                  <Rect x="112" y="164" width="76" height="25" rx="9" fill="#FFD17D" stroke="#8B51C5" strokeWidth="3" />
                  <Rect x="131" y="171" width="10" height="10" rx="3" fill="#FFF4DF" />
                  <Rect x="150" y="171" width="10" height="10" rx="3" fill="#FFF4DF" />
                </G>

                <G transform="rotate(12 234 167)">
                  <Rect x="218" y="145" width="31" height="43" rx="8" fill="#FFF7FE" stroke="#8B51C5" strokeWidth="3" />
                  <Rect x="225" y="137" width="17" height="11" rx="3" fill="#FF8F9B" stroke="#8B51C5" strokeWidth="3" />
                  <Rect x="226" y="158" width="15" height="5" rx="2.5" fill="#FFB85E" />
                  <Rect x="226" y="168" width="15" height="5" rx="2.5" fill="#FFB85E" />
                </G>

                <G transform="rotate(-25 65 201)">
                  <Rect x="58" y="178" width="14" height="47" rx="7" fill="#E9FCFF" stroke="#8B51C5" strokeWidth="3" />
                  <Circle cx="65" cy="185" r="5" fill="#FF7B83" />
                  <Path d="M65 191v21" stroke="#59B8D0" strokeWidth="4" strokeLinecap="round" />
                  <Path d="M61 214h8" stroke="#8B51C5" strokeWidth="3" strokeLinecap="round" />
                </G>

                <G transform="rotate(21 263 226)">
                  <Circle cx="263" cy="226" r="15" fill="#6ECBB7" stroke="#8B51C5" strokeWidth="3" />
                  <Path d="M256 226h14M263 219v14" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
                </G>
              </G>
            </Pattern>
          ) : null}
        </Defs>
        <Rect
          x="0"
          y="0"
          width={svgSize.width}
          height={svgSize.height}
          fill="url(#dotGrid)"
          opacity={variant === 'patient' ? 0.12 : 1}
        />
        {variant === 'patient' ? (
          <Rect
            x="0"
            y="0"
            width={svgSize.width}
            height={svgSize.height}
            fill="url(#patientMedicalPattern)"
          />
        ) : null}
      </Svg>
      {variant !== 'patient' ? (
        <View
          pointerEvents="none"
          style={[styles.artwork, variant === 'chat' && styles.chatArtwork]}
        >
          <SvgUri
            width={variant === 'chat' ? 380 : 300}
            height={variant === 'chat' ? 380 : 300}
            uri={artworkUri}
          />
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  artwork: {
    position: 'absolute',
    top: 20,
    right: -76,
    opacity: 0.32,
  },
  chatArtwork: {
    top: 14,
    right: -56,
    opacity: 0.58,
  },
});
