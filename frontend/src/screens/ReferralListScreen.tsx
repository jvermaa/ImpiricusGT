import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadReferralList } from '../api/referrals';
import type { ReferralSummary } from '../types/referrals';
import { profileCopy } from '../theme/profileCopy';
import { space } from '../theme/spacing';
import { colors } from '../theme/colors';

type Props = {
  direction: 'in' | 'out';
  withDoctor?: string;
  title: string;
};

export function ReferralListScreen({ direction, withDoctor, title }: Props) {
  const [rows, setRows] = useState<ReferralSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = () => {
    setStatus('loading');
    loadReferralList(direction, withDoctor)
      .then((list) => {
        setRows(list);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    load();
  }, [direction, withDoctor]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {status === 'loading' ? <ActivityIndicator color={colors.white} /> : null}
      {status === 'error' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry loading referrals" onPress={load}>
          <Text style={styles.retry}>Could not load referrals. Retry</Text>
        </Pressable>
      ) : null}
      {status === 'ready' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.length === 0 ? <Text style={styles.empty}>{profileCopy.noReferrals}</Text> : null}
          {rows.map((row) => (
            <View key={row.referral_key} style={styles.card}>
              <Text style={styles.cardTitle}>
                {row.patient_label ??
                  (row.status === 'pending_patient_consent'
                    ? 'Waiting for patient consent'
                    : 'Patient hidden until shared')}
              </Text>
              <Text style={styles.meta}>{row.status} · {row.urgency}</Text>
              <Text style={styles.meta}>{row.from_doctor_key} → {row.to_doctor_key}</Text>
              <Text style={styles.reason}>{row.reason}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: space.lg, paddingTop: space.sm },
  title: { color: colors.white, fontSize: 20, fontWeight: '800', marginBottom: space.md },
  list: { gap: space.md, paddingBottom: space.xl },
  card: { backgroundColor: colors.cardBg, borderRadius: space.md, padding: space.lg, gap: space.xs },
  cardTitle: { color: colors.textPrimary, fontWeight: '800' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  reason: { color: colors.textPrimary, fontSize: 14 },
  empty: { color: colors.white, fontSize: 15 },
  retry: { color: colors.white, fontWeight: '700' },
});
