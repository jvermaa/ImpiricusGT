import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DirectoryFilter } from '../api/directory';
import { CURRENT_DOCTOR_KEY } from '../api/config';
import { ChevronLeftIcon } from '../components/NavIcons';
import { DoctorProfileCard, type ProfileActions } from '../components/DoctorProfileCard';
import { DoctorDirectoryScreen } from './DoctorDirectoryScreen';
import { ReferralListScreen } from './ReferralListScreen';
import { colors } from '../theme/colors';
import { space } from '../theme/spacing';

export type ProfileRoute =
  | { name: 'card'; doctorKey: string }
  | { name: 'directory'; filter: DirectoryFilter }
  | { name: 'referrals'; direction: 'in' | 'out'; withDoctor?: string };

type Props = {
  route: ProfileRoute;
  onChangeRoute: (route: ProfileRoute) => void;
  onOpenPatients?: () => void;
  onOpenConsults?: ProfileActions['onOpenConsults'];
};

export function ProfileScreen({ route, onChangeRoute, onOpenPatients, onOpenConsults }: Props) {
  const insets = useSafeAreaInsets();
  const title = 'Profile';
  const [stack, setStack] = useState<ProfileRoute[]>([]);

  React.useEffect(() => {
    if (route.name === 'card' && route.doctorKey === CURRENT_DOCTOR_KEY) {
      setStack((current) => (current.length === 0 ? current : []));
    }
  }, [route]);

  const visit = (next: ProfileRoute) => {
    setStack((current) => [...current, route]);
    onChangeRoute(next);
  };

  const back = () => {
    const previous = stack[stack.length - 1];
    setStack((current) => current.slice(0, -1));
    onChangeRoute(previous ?? { name: 'card', doctorKey: CURRENT_DOCTOR_KEY });
  };

  const openDirectory = (filter: DirectoryFilter) => visit({ name: 'directory', filter });
  const openReferrals = (direction: 'in' | 'out', withDoctor?: string) =>
    visit({ name: 'referrals', direction, withDoctor });

  const header = route.name === 'card' && route.doctorKey === CURRENT_DOCTOR_KEY
    ? title
    : route.name === 'directory'
      ? 'Directory'
      : route.name === 'referrals'
        ? route.direction === 'in'
          ? 'Referrals in'
          : 'Referrals out'
        : 'Profile';
  const showBack = stack.length > 0 || !(route.name === 'card' && route.doctorKey === CURRENT_DOCTOR_KEY);

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, space.sm) }]}>
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={back}
            style={styles.back}
          >
            <ChevronLeftIcon color={colors.navy} size={22} />
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
        <Text style={styles.headerTitle}>{header}</Text>
      </View>
      {route.name === 'directory' ? (
        <DoctorDirectoryScreen
          filter={route.filter}
          onOpenDoctor={(doctorKey) => visit({ name: 'card', doctorKey })}
        />
      ) : route.name === 'referrals' ? (
        <ReferralListScreen direction={route.direction} withDoctor={route.withDoctor} title={header} />
      ) : (
        <DoctorProfileCard
          doctorKey={route.doctorKey}
          onOpenPatients={onOpenPatients}
          onOpenConsults={onOpenConsults}
          onOpenReferrals={openReferrals}
          onOpenDirectory={openDirectory}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.sm },
  back: { width: 32, height: 32, justifyContent: 'center' },
  headerTitle: { color: colors.navy, fontSize: 18, fontWeight: '800' },
});
