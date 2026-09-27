import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';

type Props = {
  initials: string;
  color: string;
  size?: number;
  gradient?: readonly [string, string];
  imageUri?: string;
};

export function cartoonAvatarUri(seed: string, backgroundColor?: string): string {
  const params = new URLSearchParams({
    seed,
    size: '128',
    radius: '50',
    backgroundColor: backgroundColor?.replace('#', '') ?? 'ffd6c9',
  });
  return `https://api.dicebear.com/10.x/notionists/png?${params.toString()}`;
}

export function Avatar({ initials, color, size = 48, gradient, imageUri }: Props) {
  const frame = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  if (imageUri) {
    return (
      <View style={[styles.avatar, frame, { backgroundColor: color }]}>
        <Image
          source={{ uri: imageUri }}
          resizeMode="cover"
          style={styles.image}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  const initialsText = (
    <Text style={[styles.initials, { fontSize: size * 0.34 }]}>{initials}</Text>
  );

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
    overflow: 'hidden',
  },
  initials: {
    color: colors.white,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
