import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CURRENT_DOCTOR_KEY } from '../api/config';
import { DoctorProfileCard } from '../components/DoctorProfileCard';

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 8) }]}>
      <DoctorProfileCard doctorKey={CURRENT_DOCTOR_KEY} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
