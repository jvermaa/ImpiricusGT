import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  initials: string;
  color: string;
  size?: number;
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

export function Avatar({ initials, color, size = 48, imageUri }: Props) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          resizeMode="cover"
          style={styles.image}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.34 }]}>
          {initials}
        </Text>
      )}
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
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
});
