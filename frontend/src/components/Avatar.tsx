import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';

type Props = {
  initials: string;
  color: string;
  size?: number;
  gradient?: readonly [string, string];
};

export function Avatar({ initials, color, size = 48, gradient }: Props) {
  const initialsText = (
    <Text style={[styles.initials, { fontSize: size * 0.34 }]}>{initials}</Text>
  );
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (gradient) {
    return (
      <LinearGradient
        colors={[gradient[0], gradient[1]]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.avatar, frame]}
      >
        {initialsText}
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.avatar, frame, { backgroundColor: color }]}>
      {initialsText}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: colors.white,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
