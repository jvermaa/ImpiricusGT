import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect } from 'react-native-svg';
import {
  loadDoctorProfile,
  loadPanelPatients,
  updateDoctorBio,
  updateDoctorSettings,
  type DoctorCardModel,
  type PanelPatient,
} from '../api/profile';
import type { DirectoryFilter } from '../api/directory';
import { colors } from '../theme/colors';
import { profileCopy } from '../theme/profileCopy';
import { space } from '../theme/spacing';
import { themeForSpecialty } from '../theme/specialtyThemes';
import { Avatar } from './Avatar';
import { ChatIcon, ReferHcpIcon, ShareIcon, SlidersIcon } from './NavIcons';
import { SpecialtyIcon } from './SpecialtyIcon';

export type ProfileActions = {
  onOpenPatients?: () => void;
  onOpenConsults?: (peerKey: string | null, readOnlyReason?: string) => void;
  onOpenReferrals?: (direction: 'in' | 'out', withDoctor?: string) => void;
  onOpenDirectory?: (filter: DirectoryFilter) => void;
};

type Props = ProfileActions & {
  doctorKey: string;
};

type QrCore = {
  create(
    text: string,
    options?: { errorCorrectionLevel?: string },
  ): { modules: { size: number; get(x: number, y: number): number } };
};

const pointer: ViewStyle = Platform.OS === 'web' ? ({ cursor: 'pointer' } as ViewStyle) : {};

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

async function copyText(value: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard) return false;
  await clipboard.writeText(value);
  return true;
}

export function DoctorProfileCard({
  doctorKey,
  onOpenPatients,
  onOpenConsults,
  onOpenReferrals,
  onOpenDirectory,
}: Props) {
  const [profile, setProfile] = useState<DoctorCardModel | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('Could not load this profile.');
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioSaving, setBioSaving] = useState(false);
  const [referOpen, setReferOpen] = useState(false);
  const [patients, setPatients] = useState<PanelPatient[]>([]);
  const [patientKey, setPatientKey] = useState<string | null>(null);
  const [referError, setReferError] = useState<string | null>(null);
  const [referSaving, setReferSaving] = useState(false);
  const [savingKey, setSavingKey] = useState<'consults' | 'cases' | null>(null);
  const [highlightAvailability, setHighlightAvailability] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const settingsY = useRef(0);

  const load = (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    else setStatus('loading');
    return loadDoctorProfile(doctorKey)
      .then((card) => {
        setProfile(card);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'Could not load this profile.';
        if (mode === 'refresh') setToast(message);
        else {
          setErrorText(message);
          setStatus('error');
        }
      })
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setStatus('loading');
    loadDoctorProfile(doctorKey)
      .then((card) => {
        if (!cancelled) {
          setProfile(card);
          setStatus('ready');
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setErrorText(reason instanceof Error ? reason.message : 'Could not load this profile.');
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doctorKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const theme = themeForSpecialty(profile?.specialty ?? '');
  const shareText = profile ? `${profile.headline}\n${profile.doctorKey}` : '';

  const setSetting = async (key: 'consults' | 'cases', value: boolean) => {
    if (!profile || savingKey) return;
    const previous = profile;
    const field = key === 'consults' ? 'accepts_peer_consults' : 'case_exchange_opt_in';
    setSavingKey(key);
    setProfile({
      ...profile,
      acceptsPeerConsults: key === 'consults' ? value : profile.acceptsPeerConsults,
      caseExchangeOptIn: key === 'cases' ? value : profile.caseExchangeOptIn,
    });
    try {
      const saved = await updateDoctorSettings(profile.doctorKey, { [field]: value });
      setProfile((current) =>
        current
          ? {
              ...current,
              acceptsPeerConsults: saved.accepts_peer_consults,
              caseExchangeOptIn: saved.case_exchange_opt_in,
            }
          : current,
      );
    } catch (reason: unknown) {
      setProfile(previous);
      setToast(reason instanceof Error ? reason.message : 'Could not save that setting.');
    } finally {
      setSavingKey(null);
    }
  };

  const openBio = () => {
    if (!profile?.isSelf) return;
    setBioDraft(profile.bio ?? '');
    setBioError(null);
    setBioOpen(true);
  };

  const saveBio = async () => {
    if (!profile) return;
    setBioSaving(true);
    setBioError(null);
    try {
      const saved = await updateDoctorBio(profile.doctorKey, bioDraft);
      setProfile({ ...profile, bio: saved });
      setBioOpen(false);
    } catch (reason: unknown) {
      setBioError(reason instanceof Error ? reason.message : 'Could not save the bio.');
    } finally {
      setBioSaving(false);
    }
  };

  const openRefer = () => {
    if (!profile?.canRefer) return;
    setReferError(null);
    setPatientKey(null);
    setReferOpen(true);
    loadPanelPatients()
      .then(setPatients)
      .catch((reason: unknown) => {
        setReferError(reason instanceof Error ? reason.message : 'Could not load patients.');
      });
  };

  const confirmRefer = async () => {
    if (!profile || !patientKey) return;
    setReferSaving(true);
    setReferError(null);
    try {
      // The profile demo is intentionally local: this confirms the interaction
      // without requiring a running API or sending any real referral.
      setProfile((current) =>
        current ? { ...current, referralsIn: current.referralsIn + 1 } : current,
      );
      setReferOpen(false);
      setToast('Demo referral confirmed.');
    } finally {
      setReferSaving(false);
    }
  };

  const scrollToAvailability = () => {
    scrollRef.current?.scrollTo({ y: Math.max(settingsY.current - space.sm, 0), animated: true });
    setHighlightAvailability(true);
    setTimeout(() => setHighlightAvailability(false), 1200);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.white} />
        }
      >
        {status === 'loading' ? <ProfileSkeleton /> : null}
        {status === 'error' ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile unavailable</Text>
            <Text style={styles.body}>{errorText}</Text>
            <ActionButton label="Retry loading profile" title="Retry" accent={colors.accentPurple} onPress={() => load('initial')} />
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
              <Pressable
                accessibilityRole={profile.isSelf ? 'button' : 'text'}
                accessibilityLabel={profile.isSelf ? `Edit bio for ${profile.headline}` : profile.headline}
                disabled={!profile.isSelf}
                onPress={openBio}
                style={({ pressed }) => [styles.identity, pointer, pressed && profile.isSelf && styles.pressed]}
              >
                <Avatar initials={profile.initials} color={theme.accent} gradient={theme.gradient} size={72} />
                <Text style={styles.name}>{profile.headline}</Text>
                <View style={styles.specialtyRow}>
                  <SpecialtyIcon name={theme.icon} color={theme.accent} size={16} />
                  <Text style={styles.specialty}>{profile.specialtyTitle}</Text>
                </View>
                <Text style={styles.orgLine}>
                  {profile.organization} · {profile.state}
                </Text>
              </Pressable>
              <View style={styles.badgeRow}>
                <ActionButton
                  label="About the demo profile badge"
                  title={profileCopy.demoBadge}
                  accent={colors.white}
                  outline
                  onPress={() => setDemoOpen(true)}
                />
              </View>
              <View style={styles.actions}>
                {profile.isSelf ? (
                  <>
                    <RoundAction title="Share card" label="Share card" accent={theme.accent} onPress={() => setShareOpen(true)} icon={<ShareIcon color={theme.accent} />} />
                    <RoundAction title="Edit availability" label="Edit availability" accent={theme.accent} onPress={scrollToAvailability} icon={<SlidersIcon color={theme.accent} />} />
                  </>
                ) : (
                  <>
                    <RoundAction
                      title="Message"
                      label={profile.canMessage ? `Message ${profile.displayName}` : profile.messageBlockReason ?? 'Message unavailable'}
                      accent={theme.accent}
                      disabled={!profile.canMessage}
                      onPress={() => onOpenConsults?.(profile.doctorKey)}
                      icon={<ChatIcon color={profile.canMessage ? theme.accent : colors.textMuted} size={20} />}
                    />
                    <RoundAction
                      title="Refer"
                      label={profile.canRefer ? `Refer a patient to ${profile.displayName}` : profile.referBlockReason ?? 'Refer unavailable'}
                      accent={theme.accent}
                      disabled={!profile.canRefer}
                      onPress={openRefer}
                      icon={<ReferHcpIcon color={profile.canRefer ? theme.accent : colors.textMuted} size={20} />}
                    />
                    <RoundAction title="Share" label={`Share ${profile.displayName}`} accent={theme.accent} onPress={() => setShareOpen(true)} icon={<ShareIcon color={theme.accent} />} />
                  </>
                )}
              </View>
              {!profile.isSelf && !profile.canMessage && profile.messageBlockReason ? (
                <Text style={styles.reason}>{profile.messageBlockReason}</Text>
              ) : null}
              {!profile.isSelf && !profile.canRefer && profile.referBlockReason ? (
                <Text style={styles.reason}>{profile.referBlockReason}</Text>
              ) : null}
              <View style={styles.stats}>
                {profile.isSelf ? (
                  <Stat label="Patients" value={profile.patientCount ?? 0} accent={theme.accent} onPress={onOpenPatients} blockedReason={onOpenPatients ? undefined : 'Patient list is not available here.'} />
                ) : null}
                <Stat
                  label={profile.isSelf ? 'Consults' : 'Consults with you'}
                  value={profile.consultThreadCount}
                  accent={theme.accent}
                  onPress={
                    profile.isSelf
                      ? () => onOpenConsults?.(null)
                      : profile.mutualThreadId
                        ? () => onOpenConsults?.(profile.doctorKey, profile.canMessage ? undefined : profile.messageBlockReason ?? undefined)
                        : undefined
                  }
                  blockedReason={
                    !profile.isSelf && !profile.mutualThreadId
                      ? 'No consult thread yet.'
                      : onOpenConsults
                        ? undefined
                        : 'Chat is not available here.'
                  }
                />
                <Stat
                  label={profile.isSelf ? 'Referrals in' : 'Referrals they sent you'}
                  value={profile.referralsIn}
                  accent={theme.accent}
                  onPress={() => onOpenReferrals?.('in', profile.isSelf ? undefined : profile.doctorKey)}
                  blockedReason={onOpenReferrals ? undefined : 'Referral list is not available here.'}
                />
                <Stat
                  label={profile.isSelf ? 'Referrals out' : 'Referrals you sent'}
                  value={profile.referralsOut}
                  accent={theme.accent}
                  onPress={() => onOpenReferrals?.('out', profile.isSelf ? undefined : profile.doctorKey)}
                  blockedReason={onOpenReferrals ? undefined : 'Referral list is not available here.'}
                />
              </View>
            </LinearGradient>

            {!profile.isSelf && profile.mutualLastMessage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open the mutual consult thread"
                onPress={() => onOpenConsults?.(profile.doctorKey, profile.canMessage ? undefined : profile.messageBlockReason ?? undefined)}
                style={({ pressed }) => [styles.section, pointer, pressed && styles.pressed]}
              >
                <Text style={styles.sectionTitle}>Mutual</Text>
                <Text style={styles.body}>{profile.mutualLastMessage}</Text>
              </Pressable>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              {profile.isSelf ? (
                <Pressable accessibilityRole="button" accessibilityLabel={profile.bio ? 'Edit bio' : profileCopy.addBio} onPress={openBio} style={({ pressed }) => [pointer, pressed && styles.pressed]}>
                  <Text style={profile.bio ? styles.body : styles.prompt}>{profile.bio ?? profileCopy.addBio}</Text>
                </Pressable>
              ) : profile.bio ? (
                <Text style={styles.body}>{profile.bio}</Text>
              ) : null}
              <Text style={styles.plain}>Focus: {profile.subspecialtyFocus}</Text>
              <Text style={styles.plain}>{profile.yearsInPractice} years in practice</Text>
              <View style={styles.chips}>
                <Chip label={profile.specialty} onPress={() => onOpenDirectory?.({ specialty: profile.specialty })} />
                <Chip label={profile.subspecialtyFocus} onPress={() => onOpenDirectory?.({ focus: profile.subspecialtyFocus })} />
                <Chip label={readableLabel(profile.practiceType)} onPress={() => onOpenDirectory?.({ practiceType: profile.practiceType })} />
                {profile.languages.map((language) => (
                  <Chip key={language} label={language} onPress={() => onOpenDirectory?.({ language })} />
                ))}
                <Chip label={profile.organization} onPress={() => onOpenDirectory?.({ organization: profile.organization })} />
                <Chip label={profile.state} onPress={() => onOpenDirectory?.({ state: profile.state })} />
              </View>
              {!onOpenDirectory ? <Text style={styles.hint}>Directory filters are not available on this screen.</Text> : null}
            </View>

            {profile.isSelf ? (
              <View
                style={[styles.section, highlightAvailability && { borderColor: theme.accent, borderWidth: 2 }]}
                onLayout={(event) => {
                  settingsY.current = event.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.sectionTitle}>Availability</Text>
                <SettingRow
                  title="Accept peer consults"
                  detail={profile.acceptsPeerConsults ? profileCopy.consultsOn : profileCopy.consultsOff}
                  value={profile.acceptsPeerConsults}
                  accent={theme.accent}
                  saving={savingKey === 'consults'}
                  onChange={(value) => setSetting('consults', value)}
                />
                <SettingRow
                  title="Share de-identified cases"
                  detail={profile.caseExchangeOptIn ? profileCopy.sharingOn : profileCopy.sharingOff}
                  value={profile.caseExchangeOptIn}
                  accent={theme.accent}
                  saving={savingKey === 'cases'}
                  onChange={(value) => setSetting('cases', value)}
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

      <Sheet visible={demoOpen} onClose={() => setDemoOpen(false)} title={profileCopy.demoTitle}>
        <Text style={styles.sheetBody}>{profileCopy.demoBody}</Text>
      </Sheet>

      <Sheet visible={shareOpen} onClose={() => setShareOpen(false)} title={profile?.headline ?? 'Share card'}>
        <Text style={styles.sheetKey}>{profile?.doctorKey}</Text>
        {shareText ? <QrMark text={shareText} /> : null}
        <Text style={styles.sheetBody}>{profileCopy.shareHint}</Text>
        <View style={styles.sheetButtons}>
          <ActionButton
            label="Copy doctor card"
            title="Copy"
            accent={theme.accent}
            onPress={() => {
              copyText(shareText)
                .then((ok) => setToast(ok ? 'Copied.' : 'Copy is not available on this device.'))
                .catch(() => setToast('Could not copy the card.'));
            }}
          />
          <ActionButton
            label="Share doctor card"
            title="Share"
            accent={theme.accent}
            onPress={() => {
              Share.share({ message: shareText }).catch(() => setToast('Could not open the share sheet.'));
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={bioOpen} onClose={() => setBioOpen(false)} title="Bio">
        <TextInput
          value={bioDraft}
          onChangeText={setBioDraft}
          multiline
          maxLength={320}
          placeholder={profileCopy.bioPlaceholder}
          placeholderTextColor={colors.searchPlaceholder}
          style={styles.bioInput}
        />
        <Text style={styles.counter}>{bioDraft.trim().length}/280</Text>
        {bioError ? <Text style={styles.errorText}>{bioError}</Text> : null}
        <View style={styles.sheetButtons}>
          <ActionButton label="Cancel bio edit" title="Cancel" accent={colors.textMuted} outline onPress={() => setBioOpen(false)} />
          <ActionButton
            label="Save bio"
            title={bioSaving ? 'Saving' : 'Save'}
            accent={theme.accent}
            disabled={bioSaving || bioDraft.trim() === (profile?.bio ?? '')}
            onPress={saveBio}
          />
        </View>
      </Sheet>

      <Sheet visible={referOpen} onClose={() => setReferOpen(false)} title={`Refer to ${profile?.displayName ?? 'doctor'}`}>
        <ScrollView style={styles.patientList}>
          {patients.map((patient) => {
            const selected = patient.patientKey === patientKey;
            return (
              <Pressable
                key={patient.patientKey}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Select ${patient.label}`}
                onPress={() => setPatientKey(patient.patientKey)}
                style={({ pressed }) => [styles.patientRow, selected && styles.patientRowSelected, pointer, pressed && styles.pressed]}
              >
                <Text style={styles.patientName}>{patient.label}</Text>
                <Text style={styles.plain}>{patient.detail}</Text>
              </Pressable>
            );
          })}
          {patients.length === 0 ? <Text style={styles.body}>{profileCopy.noPatients}</Text> : null}
        </ScrollView>
        {referError ? <Text style={styles.errorText}>{referError}</Text> : null}
        <ActionButton
          label="Confirm referral"
          title={referSaving ? 'Sending' : 'Confirm referral'}
          accent={theme.accent}
          disabled={!patientKey || referSaving}
          onPress={confirmRefer}
        />
      </Sheet>
    </View>
  );
}

function Stat({
  label,
  value,
  accent,
  onPress,
  blockedReason,
}: {
  label: string;
  value: number;
  accent: string;
  onPress?: () => void;
  blockedReason?: string;
}) {
  const disabled = !onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={disabled ? `${label}, ${blockedReason ?? 'unavailable'}` : `Open ${label}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.stat, pointer, pressed && !disabled && styles.pressed, disabled && styles.dimmed]}
    >
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !onPress }}
      accessibilityLabel={`Filter directory by ${label}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pointer, pressed && styles.pressed]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

function SettingRow({
  title,
  detail,
  value,
  accent,
  saving,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  accent: string;
  saving: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingDetail}>{detail}</Text>
      </View>
      {saving ? <ActivityIndicator color={accent} /> : null}
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={title}
        accessibilityState={{ checked: value, disabled: saving }}
        disabled={saving}
        onPress={() => onChange(!value)}
        style={[
          styles.switchTrack,
          pointer,
          { backgroundColor: value ? accent : '#3A4158', borderColor: value ? accent : '#8B90A0' },
        ]}
      >
        <View style={[styles.switchThumb, value ? styles.switchThumbOn : null, { backgroundColor: value ? accent : '#C5CAD6' }]} />
      </Pressable>
    </View>
  );
}

function RoundAction({
  label,
  title,
  accent,
  onPress,
  icon,
  disabled,
}: {
  label: string;
  title: string;
  accent: string;
  onPress?: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pointer, pressed && !disabled && styles.pressed, disabled && styles.dimmed]}
    >
      <View style={[styles.actionCircle, { borderColor: disabled ? colors.textMuted : accent }]}>{icon}</View>
      <Text style={styles.actionLabel}>{title}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  title,
  accent,
  onPress,
  disabled,
  outline,
}: {
  label: string;
  title: string;
  accent: string;
  onPress?: () => void;
  disabled?: boolean;
  outline?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textButton,
        pointer,
        { backgroundColor: outline ? 'transparent' : accent, borderColor: accent },
        pressed && !disabled && styles.pressed,
        disabled && styles.dimmed,
      ]}
    >
      <Text style={[styles.textButtonLabel, { color: outline ? accent : colors.navy }]}>{title}</Text>
    </Pressable>
  );
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ProfileSkeleton() {
  return (
    <View style={styles.skeleton}>
      <View style={styles.skeletonAvatar} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonLineShort} />
    </View>
  );
}

function QrMark({ text }: { text: string }) {
  const matrix = useMemo(() => qrMatrix(text), [text]);
  if (!matrix) return <Text style={styles.sheetKey}>{text}</Text>;
  const cell = 6;
  const size = matrix.length * cell;
  return (
    <View style={styles.qrFrame}>
      <Svg width={size} height={size}>
        <Rect x={0} y={0} width={size} height={size} fill={colors.white} />
        {matrix.flatMap((row, y) =>
          row.map((on, x) =>
            on ? <Rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={colors.navy} /> : null,
          ),
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.md },
  headerCard: { borderRadius: space.lg, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md },
  identity: { alignItems: 'center', gap: space.xs },
  name: { color: colors.white, fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: space.xs },
  specialtyRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  specialty: { color: colors.white, fontSize: 14, fontWeight: '600' },
  orgLine: { color: 'rgba(255,255,255,0.82)', fontSize: 13, textAlign: 'center' },
  badgeRow: { alignItems: 'center', marginTop: space.sm },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: space.lg, marginTop: space.md },
  action: { alignItems: 'center', width: 76 },
  actionCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  actionLabel: { color: colors.white, fontSize: 11, fontWeight: '600', marginTop: space.xs, textAlign: 'center' },
  reason: { color: 'rgba(255,255,255,0.88)', fontSize: 12, textAlign: 'center', marginTop: space.sm },
  stats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: space.md,
    backgroundColor: 'rgba(10,14,39,0.82)',
    borderRadius: space.md,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: space.sm },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2, textAlign: 'center' },
  section: {
    backgroundColor: colors.cardBg,
    borderRadius: space.lg,
    padding: space.lg,
    gap: space.sm,
  },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: space.sm },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  plain: { color: colors.textSecondary, fontSize: 14 },
  prompt: { color: colors.accentPurple, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { backgroundColor: colors.navyMid, borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: space.xs },
  chipText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  setting: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  settingCopy: { flex: 1 },
  settingTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  settingDetail: { color: colors.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  switchThumb: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.white },
  switchThumbOn: { alignSelf: 'flex-end' },
  textButton: { borderRadius: 999, borderWidth: 1.5, paddingHorizontal: space.md, paddingVertical: space.sm },
  textButtonLabel: { fontWeight: '800', fontSize: 13 },
  pressed: { opacity: 0.72 },
  dimmed: { opacity: 0.45 },
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.md,
    backgroundColor: colors.panelBg,
    borderRadius: space.md,
    padding: space.md,
  },
  toastText: { color: colors.white, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end', padding: space.lg },
  sheet: { backgroundColor: colors.cardBg, borderRadius: space.lg, padding: space.lg, gap: space.sm, maxHeight: '80%' },
  sheetTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  sheetBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  sheetKey: { color: colors.textMuted, fontSize: 13 },
  sheetButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  bioInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: 'rgba(26,26,46,0.16)',
    borderRadius: space.md,
    padding: space.md,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  counter: { color: colors.textMuted, fontSize: 12, textAlign: 'right' },
  errorText: { color: colors.matchRed, fontSize: 13 },
  patientList: { maxHeight: 240 },
  patientRow: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(26,26,46,0.08)' },
  patientRowSelected: { backgroundColor: 'rgba(123,97,255,0.12)' },
  patientName: { color: colors.textPrimary, fontWeight: '700' },
  qrFrame: { alignSelf: 'center', padding: space.sm, backgroundColor: colors.white, borderRadius: space.sm },
  skeleton: {
    borderRadius: space.lg,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
  skeletonAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.28)' },
  skeletonLine: { width: '62%', height: 14, borderRadius: space.xs, backgroundColor: 'rgba(255,255,255,0.28)' },
  skeletonLineShort: { width: '40%', height: 12, borderRadius: space.xs, backgroundColor: 'rgba(255,255,255,0.2)' },
});
