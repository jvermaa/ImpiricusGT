import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  loadDoctorProfile,
  updateDoctorSettings,
  type DoctorCardModel,
} from '../api/profile';
import { colors } from '../theme/colors';
import { themeForSpecialty } from '../theme/specialtyThemes';
import { Avatar } from './Avatar';
import { SpecialtyIcon } from './SpecialtyIcon';

type Props = {
  doctorKey: string;
  onMessage?: (doctorKey: string) => void;
  onRefer?: (doctorKey: string) => void;
};

type QrCore = {
  create(
    text: string,
    options?: { errorCorrectionLevel?: string },
  ): { modules: { size: number; get(x: number, y: number): number } };
};

function readableLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function qrMatrix(text: string): boolean[][] | null {
  try {
    // Subpath stays on the pure JS encoder so web and Expo Go do not load node canvas.
    const core = require('qrcode/lib/core/qrcode') as QrCore;
    const code = core.create(text, { errorCorrectionLevel: 'M' });
    const size = code.modules.size;
    const rows: boolean[][] = [];
    for (let y = 0; y < size; y += 1) {
      const row: boolean[] = [];
      for (let x = 0; x < size; x += 1) row.push(Boolean(code.modules.get(x, y)));
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}

function useCountUp(target: number, animate: boolean): number {
  const [shown, setShown] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) {
      setShown(target);
      return;
    }
    const started = Date.now();
    const duration = 720;
    let frame = 0;
    const tick = () => {
      const progress = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);
  return shown;
}

export function DoctorProfileCard({ doctorKey, onMessage, onRefer }: Props) {
  const [profile, setProfile] = useState<DoctorCardModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('Could not load this profile.');
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [animateStats, setAnimateStats] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const settingsY = useRef(0);
  const saving = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setStatus('loading');
    setAnimateStats(true);
    loadDoctorProfile(doctorKey)
      .then((card) => {
        if (cancelled) return;
        setProfile(card);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setErrorText(reason instanceof Error ? reason.message : 'Could not load this profile.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [doctorKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const card = await loadDoctorProfile(doctorKey);
      setAnimateStats(false);
      setProfile(card);
      setStatus('ready');
    } catch {
      setToast('Could not refresh this profile.');
    } finally {
      setRefreshing(false);
    }
  };

  const theme = themeForSpecialty(profile?.specialty ?? '');

  const setSetting = async (
    key: 'accepts_peer_consults' | 'case_exchange_opt_in',
    value: boolean,
  ) => {
    if (!profile || saving.current) return;
    const previous = profile;
    saving.current = true;
    setProfile({
      ...profile,
      acceptsPeerConsults: key === 'accepts_peer_consults' ? value : profile.acceptsPeerConsults,
      caseExchangeOptIn: key === 'case_exchange_opt_in' ? value : profile.caseExchangeOptIn,
    });
    try {
      const settings = await updateDoctorSettings(profile.doctorKey, { [key]: value });
      setProfile((current) =>
        current
          ? {
              ...current,
              acceptsPeerConsults: settings.accepts_peer_consults,
              caseExchangeOptIn: settings.case_exchange_opt_in,
            }
          : current,
      );
    } catch {
      setProfile(previous);
      setToast('Could not save that setting.');
    } finally {
      saving.current = false;
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.white} />
        }
      >
        {status === 'loading' ? <ProfileSkeleton /> : null}
        {status === 'error' ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Profile unavailable</Text>
            <Text style={styles.errorBody}>{errorText}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading profile"
              onPress={() => {
                setStatus('loading');
                loadDoctorProfile(doctorKey)
                  .then((card) => {
                    setProfile(card);
                    setStatus('ready');
                  })
                  .catch((reason: unknown) => {
                    setErrorText(reason instanceof Error ? reason.message : errorText);
                    setStatus('error');
                  });
              }}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {status === 'ready' && profile ? (
          <>
            <LinearGradient
              colors={[theme.gradient[0], theme.gradient[1]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerCard}
            >
              <View style={styles.avatarRing}>
                <Avatar
                  initials={profile.initials}
                  color={theme.accent}
                  gradient={theme.gradient}
                  size={108}
                />
              </View>
              <Text style={styles.name}>{profile.headline}</Text>
              <View style={styles.specialtyRow}>
                <SpecialtyIcon name={theme.icon} color={theme.accent} size={18} />
                <Text style={styles.specialty}>{profile.specialtyTitle}</Text>
              </View>
              <Text style={styles.orgLine}>
                {profile.organization} · {profile.state}
              </Text>
              <View style={styles.badgeRow}>
                {profile.verification === 'demo' ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Demo profile</Text>
                  </View>
                ) : null}
                {!profile.isSelf && profile.hasConsultThread ? (
                  <View style={[styles.badge, { borderColor: theme.accent }]}>
                    <Text style={[styles.badgeText, { color: theme.accent }]}>Mutual</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.actions}>
                {profile.isSelf ? (
                  <>
                    <RoundAction
                      label="Share card"
                      accent={theme.accent}
                      onPress={() => setShareOpen(true)}
                      icon={<ShareIcon color={theme.accent} />}
                    />
                    <RoundAction
                      label="Edit availability"
                      accent={theme.accent}
                      onPress={() => scrollRef.current?.scrollTo({ y: settingsY.current, animated: true })}
                      icon={<SlidersIcon color={theme.accent} />}
                    />
                  </>
                ) : (
                  <>
                    {profile.acceptsPeerConsults && onMessage ? (
                      <RoundAction
                        label="Message"
                        accent={theme.accent}
                        onPress={() => onMessage(profile.doctorKey)}
                        icon={<BubbleIcon color={theme.accent} />}
                      />
                    ) : null}
                    {onRefer ? (
                      <RoundAction
                        label="Refer"
                        accent={theme.accent}
                        onPress={() => onRefer(profile.doctorKey)}
                        icon={<ReferIcon color={theme.accent} />}
                      />
                    ) : null}
                    {profile.professionalEmail ? (
                      <RoundAction
                        label="Email"
                        accent={theme.accent}
                        onPress={() => {
                          const address = profile.professionalEmail;
                          if (!address) return;
                          Linking.openURL(`mailto:${address}`).catch(() => {
                            setToast('Could not open mail for this address.');
                          });
                        }}
                        icon={<MailIcon color={theme.accent} />}
                      />
                    ) : null}
                  </>
                )}
              </View>
              <View style={styles.stats}>
                <Stat label="Patients" value={profile.patientCount} accent={theme.accent} animate={animateStats} />
                <Stat label="Consults" value={profile.peerConsultThreads} accent={theme.accent} animate={animateStats} />
                <Stat label="Referrals in" value={profile.referralsReceived} accent={theme.accent} animate={animateStats} />
                <Stat label="Years" value={profile.yearsInPractice} accent={theme.accent} animate={animateStats} />
              </View>
            </LinearGradient>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.aboutLine}>{profile.subspecialtyFocus}</Text>
              <View style={styles.chips}>
                <Chip label={readableLabel(profile.practiceType)} />
                {profile.languages.map((language) => (
                  <Chip key={language} label={language} />
                ))}
              </View>
            </View>

            {profile.isSelf ? (
              <View
                style={styles.section}
                onLayout={(event) => {
                  settingsY.current = event.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.sectionTitle}>Availability</Text>
                <SettingRow
                  title="Accept peer consults"
                  detail="Other doctors can message you."
                  value={profile.acceptsPeerConsults}
                  accent={theme.accent}
                  onChange={(value) => setSetting('accepts_peer_consults', value)}
                />
                <SettingRow
                  title="Share de-identified cases"
                  detail="Your consented patients can appear in similar-case search."
                  value={profile.caseExchangeOptIn}
                  accent={theme.accent}
                  onChange={(value) => setSetting('case_exchange_opt_in', value)}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      <Modal visible={shareOpen} transparent animationType="fade" onRequestClose={() => setShareOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.shareCard} onPress={() => undefined}>
            <Text style={styles.shareTitle}>{profile?.headline ?? 'Doctor card'}</Text>
            <Text style={styles.shareKey}>{profile?.doctorKey}</Text>
            {profile ? <QrMark text={`${profile.doctorKey} ${profile.displayName}`} /> : null}
            <Text style={styles.shareHint}>A peer can scan this for the doctor key and name.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close share card"
              onPress={() => setShareOpen(false)}
              style={[styles.retryButton, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.shareCloseText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Stat({
  label,
  value,
  accent,
  animate,
}: {
  label: string;
  value: number;
  accent: string;
  animate: boolean;
}) {
  const shown = useCountUp(value, animate);
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: accent }]}>{shown}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

function SettingRow({
  title,
  detail,
  value,
  accent,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  accent: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDetail}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: 'rgba(26,26,46,0.18)', true: accent }}
        thumbColor={colors.white}
      />
    </View>
  );
}

function RoundAction({
  label,
  accent,
  onPress,
  icon,
}: {
  label: string;
  accent: string;
  onPress: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.action}
    >
      <View style={[styles.actionCircle, { borderColor: accent, backgroundColor: 'rgba(255,255,255,0.14)' }]}>
        {icon}
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function ProfileSkeleton() {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={{ opacity: pulse }}>
      <View style={styles.skeletonHeader}>
        <View style={styles.skeletonAvatar} />
        <View style={styles.skeletonLineWide} />
        <View style={styles.skeletonLine} />
        <View style={styles.skeletonStats}>
          <View style={styles.skeletonStat} />
          <View style={styles.skeletonStat} />
          <View style={styles.skeletonStat} />
          <View style={styles.skeletonStat} />
        </View>
      </View>
      <View style={styles.skeletonSection} />
    </Animated.View>
  );
}

function QrMark({ text }: { text: string }) {
  const matrix = useMemo(() => qrMatrix(text), [text]);
  if (!matrix) {
    return <Text style={styles.shareKey}>{text}</Text>;
  }
  const cell = 7;
  const size = matrix.length * cell;
  return (
    <View style={styles.qrFrame}>
      <Svg width={size} height={size}>
        <Rect x={0} y={0} width={size} height={size} fill={colors.white} />
        {matrix.map((row, y) =>
          row.map((on, x) =>
            on ? (
              <Rect
                key={`${x}-${y}`}
                x={x * cell}
                y={y * cell}
                width={cell}
                height={cell}
                fill={colors.navy}
              />
            ) : null,
          ),
        )}
      </Svg>
    </View>
  );
}

function ShareIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M12 14.5V4.8M12 4.8 8.6 8.2M12 4.8l3.4 3.4" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6 12.5v5.2A1.8 1.8 0 0 0 7.8 19.5h8.4a1.8 1.8 0 0 0 1.8-1.8v-5.2" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

function SlidersIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M5 7.5h14M5 16.5h14" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
      <Path d="M9 7.5a2 2 0 1 0 0 .01M15 16.5a2 2 0 1 0 0 .01" stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

function BubbleIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 7.2A3.2 3.2 0 0 1 9.2 4h5.6A3.2 3.2 0 0 1 18 7.2v5.1a3.2 3.2 0 0 1-3.2 3.2H10l-3.2 2.6v-2.2A3.2 3.2 0 0 1 6 12.3V7.2Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ReferIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M8.5 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.8 18.2c.4-2.4 2-3.8 3.7-3.8s3.3 1.4 3.7 3.8" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M16.2 8.2v5.2M13.6 10.8h5.2" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

function MailIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M5 7.2h14v9.6H5V7.2Z" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="m5.4 7.6 6.6 5.2 6.6-5.2" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28, gap: 14 },
  headerCard: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 16,
    alignItems: 'center',
  },
  avatarRing: {
    padding: 4,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginBottom: 12,
  },
  name: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  specialtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  specialty: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '600',
  },
  orgLine: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    marginTop: 16,
  },
  action: { alignItems: 'center', width: 84 },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  stats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: 16,
    backgroundColor: 'rgba(10,14,39,0.82)',
    borderRadius: 16,
    paddingVertical: 12,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  section: {
    backgroundColor: colors.cardBg,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  aboutLine: {
    color: colors.textSecondary,
    fontSize: 15,
    marginBottom: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.navyMid,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  settingCopy: { flex: 1 },
  settingTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  settingDetail: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  errorCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 18,
    padding: 20,
    alignItems: 'flex-start',
    gap: 8,
  },
  errorTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  errorBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  retryButton: {
    marginTop: 8,
    backgroundColor: colors.accentPurple,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: colors.white, fontWeight: '700' },
  shareCloseText: { color: colors.navy, fontWeight: '800' },
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 12,
    backgroundColor: colors.panelBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  toastText: { color: colors.white, fontSize: 14, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  shareCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.cardBg,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  shareTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  shareKey: { color: colors.textMuted, marginTop: 4, marginBottom: 12, fontSize: 13 },
  shareHint: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },
  qrFrame: {
    padding: 10,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(26,26,46,0.08)',
  },
  skeletonHeader: {
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  skeletonAvatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  skeletonLineWide: {
    width: '70%',
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  skeletonLine: {
    width: '46%',
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  skeletonStats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 8,
    marginTop: 8,
  },
  skeletonStat: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  skeletonSection: {
    height: 96,
    borderRadius: 18,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
});
