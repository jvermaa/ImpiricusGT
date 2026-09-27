import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { DoctorProfileCard } from '../components/DoctorProfileCard';
import { ChatThread } from '../components/ChatThread';
import {
  ChevronLeftIcon,
  CloseIcon,
  FilterIcon,
  PlusIcon,
  SearchIcon,
} from '../components/NavIcons';
import type { ChatMessage, CurrentDoctor, DoctorProfile, DoctorThread } from '../types/chat';
import { DEMO_CURRENT_DOCTOR, DEMO_THREADS, DOCTOR_DIRECTORY, SPECIALTIES } from '../data/chatMock';
import { searchDoctorsByNameOrSpecialization } from '../data/doctorDiscovery';
import type { DirectoryFilter } from '../api/directory';
import { loadConsultDirectory, loadCurrentDoctor } from '../api/clinic';
import { colors } from '../theme/colors';
import { ReferralWorkspace } from './ReferralWorkspace';

type ChatLaunch = {
  peerKey: string | null;
  readOnlyReason?: string;
} | null;

export function ChatScreen({
  launch = null,
  onLaunchHandled,
  onOpenPatients,
  onOpenReferrals,
  onOpenDirectory,
}: {
  launch?: ChatLaunch;
  onLaunchHandled?: () => void;
  onOpenPatients?: () => void;
  onOpenReferrals?: (direction: 'in' | 'out', withDoctor?: string) => void;
  onOpenDirectory?: (filter: DirectoryFilter) => void;
}) {
  const insets = useSafeAreaInsets();
  const [activeDoctorId, setActiveDoctorId] = useState<string | null>(null);
  const [profileDoctorId, setProfileDoctorId] = useState<string | null>(null);
  const [threads, setThreads] = useState<DoctorThread[]>(DEMO_THREADS);
  const [directory, setDirectory] = useState<DoctorProfile[]>(DOCTOR_DIRECTORY);
  const [specialties, setSpecialties] = useState<string[]>(SPECIALTIES);
  const [currentDoctor, setCurrentDoctor] = useState<CurrentDoctor>(DEMO_CURRENT_DOCTOR);
  const [specialtyFilter, setSpecialtyFilter] = useState('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [referralDoctorId, setReferralDoctorId] = useState<string | null>(null);
  const [referralSuccessMessage, setReferralSuccessMessage] = useState<string | null>(null);
  const [directoryReady, setDirectoryReady] = useState(false);
  const [threadReadOnly, setThreadReadOnly] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);

  const activeDoctor = useMemo(
    () => threads.find((t) => t.id === activeDoctorId) ?? null,
    [threads, activeDoctorId],
  );
  const profileDoctor = useMemo(
    () =>
      directory.find((doctor) => doctor.id === profileDoctorId) ??
      threads.find((doctor) => doctor.id === profileDoctorId) ??
      null,
    [directory, threads, profileDoctorId],
  );
  const referralDoctor = useMemo(
    () =>
      directory.find((doctor) => doctor.id === referralDoctorId) ??
      threads.find((doctor) => doctor.id === referralDoctorId) ??
      null,
    [directory, threads, referralDoctorId],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCurrentDoctor(), loadConsultDirectory()])
      .then(([doctor, consultData]) => {
        if (cancelled) return;
        setCurrentDoctor(doctor);
        setDirectory(consultData.directory);
        setThreads(consultData.threads.length > 0 ? consultData.threads : DEMO_THREADS);
        setSpecialties(consultData.specialties.length > 1 ? consultData.specialties : SPECIALTIES);
        setLoadError(null);
        setDirectoryReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Could not load consult directory — showing demo threads.');
        setDirectoryReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showingProfile = !!profileDoctor && !activeDoctor;
  const showingList = !activeDoctor && !showingProfile;

  const headerTitle = activeDoctor
    ? activeDoctor.name
    : profileDoctor
      ? 'Profile'
      : 'Doctors';
  const headerSubtitle = activeDoctor
    ? activeDoctor.designation
    : profileDoctor
      ? profileDoctor.designation
      : specialtyFilter === 'All'
        ? 'Peer consults'
        : specialtyFilter;

  const startOrOpenChat = (doctor: DoctorProfile) => {
    setThreadReadOnly(undefined);
    setThreads((prev) => {
      if (prev.some((entry) => entry.id === doctor.id)) return prev;
      const fresh: DoctorThread = {
        ...doctor,
        threadId: `demo-${doctor.id}`,
        lastMessage: 'New consult',
        messages: [],
      };
      return [fresh, ...prev];
    });
    setActiveDoctorId(doctor.id);
    setProfileDoctorId(null);
    setNewChatOpen(false);
    setFilterOpen(false);
    setReferralSuccessMessage(null);
  };

  useEffect(() => {
    if (!launch || !directoryReady) return;
    if (!launch.peerKey) {
      setActiveDoctorId(null);
      setProfileDoctorId(null);
      setThreadReadOnly(undefined);
      onLaunchHandled?.();
      return;
    }
    const doctor =
      directory.find((item) => item.id === launch.peerKey) ??
      threads.find((item) => item.id === launch.peerKey);
    if (doctor) {
      startOrOpenChat(doctor);
    } else {
      setActiveDoctorId(launch.peerKey);
      setProfileDoctorId(null);
    }
    setThreadReadOnly(launch.readOnlyReason);
    onLaunchHandled?.();
  }, [launch, directoryReady]);

  const openDoctorProfile = (doctor: DoctorProfile) => {
    setProfileDoctorId(doctor.id);
    setActiveDoctorId(null);
    setNewChatOpen(false);
    setFilterOpen(false);
    setReferralSuccessMessage(null);
  };

  const sendDoctor = (text: string) => {
    if (!activeDoctor?.threadId || threadReadOnly) return;
    const threadId = activeDoctor.threadId;
    const message: ChatMessage = {
      id: `local-${Date.now()}`,
      senderId: currentDoctor.id,
      text,
      timestamp: 'Just now',
    };
    setThreads((prev) =>
      prev.map((entry) =>
        entry.threadId === threadId
          ? { ...entry, messages: [...entry.messages, message], lastMessage: text }
          : entry,
      ),
    );
  };

  const goBackToList = () => {
    setActiveDoctorId(null);
    setProfileDoctorId(null);
    setFilterOpen(false);
  };

  const openReferralPicker = (doctorId: string) => {
    if (!/^D\d+/i.test(doctorId)) {
      setLoadError('Formal referral needs an API doctor. Wait for the directory to load, then try again.');
      return;
    }
    if (!/^D\d+/i.test(currentDoctor.id)) {
      setLoadError('Could not load your doctor profile for referrals. Is the API running?');
      return;
    }
    setReferralDoctorId(doctorId);
    setReferralSuccessMessage(null);
  };

  const closeReferralFlow = () => {
    setReferralDoctorId(null);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            activeDoctor || showingProfile ? 'Back to doctor list' : 'Doctors'
          }
          onPress={activeDoctor || showingProfile ? goBackToList : undefined}
          disabled={!activeDoctor && !showingProfile}
          style={styles.headerLeft}
        >
          {activeDoctor || showingProfile ? (
            <ChevronLeftIcon color={colors.white} size={22} />
          ) : null}
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {headerTitle}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          </View>
        </Pressable>

        {showingList ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filter by specialty"
            onPress={() => setFilterOpen((v) => !v)}
            style={[
              styles.filterBtn,
              specialtyFilter !== 'All' && styles.filterBtnActive,
            ]}
          >
            <FilterIcon
              color={
                specialtyFilter !== 'All' ? colors.accentPurple : colors.white
              }
              size={20}
            />
          </Pressable>
        ) : activeDoctor ? (
          <View style={styles.chatHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Refer from chat with ${activeDoctor.name}`}
              onPress={() => openReferralPicker(activeDoctor.id)}
              style={styles.chatReferBtn}
            >
              <Text style={styles.chatReferText}>Refer</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${activeDoctor.name} profile`}
              onPress={() => openDoctorProfile(activeDoctor)}
              style={styles.chatAvatarButton}
            >
              <Avatar
                initials={activeDoctor.initials}
                color={activeDoctor.avatarColor}
                size={36}
              />
            </Pressable>
          </View>
        ) : null}
      </View>

      {showingList && filterOpen ? (
        <SpecialtyFilterMenu
          selected={specialtyFilter}
          specialties={specialties}
          onSelect={(s) => {
            setSpecialtyFilter(s);
            setFilterOpen(false);
          }}
          onClose={() => setFilterOpen(false)}
        />
      ) : null}

      <View style={styles.body}>
        {showingList ? (
          <DoctorList
            threads={threads}
            doctorName={currentDoctor.name}
            statusMessage={loadError}
            specialtyFilter={specialtyFilter}
            onSelect={(id) => {
              const doctor = threads.find((entry) => entry.id === id);
              if (doctor) startOrOpenChat(doctor);
            }}
            onNewChat={() => {
              setFilterOpen(false);
              setNewChatOpen(true);
            }}
          />
        ) : showingProfile && profileDoctor ? (
          <View style={styles.flex}>
            {referralSuccessMessage ? (
              <View style={[styles.successBanner, styles.successBannerClear]}>
                <Text style={styles.successBannerText}>{referralSuccessMessage}</Text>
              </View>
            ) : null}
            <DoctorProfileCard
              doctorKey={profileDoctor.id}
              onOpenPatients={onOpenPatients}
              onOpenConsults={(peerKey, reason) => {
                const doctor =
                  directory.find((item) => item.id === peerKey) ??
                  threads.find((item) => item.id === peerKey) ??
                  profileDoctor;
                if (doctor && doctor.id === peerKey) startOrOpenChat(doctor);
                setThreadReadOnly(reason);
              }}
              onOpenReferrals={onOpenReferrals}
              onOpenDirectory={onOpenDirectory}
            />
          </View>
        ) : activeDoctor ? (
          <View style={styles.flex}>
          <ChatThread
            messages={activeDoctor.messages}
            readOnlyReason={threadReadOnly}
            onSend={sendDoctor}
            currentUserId={currentDoctor.id}
            peerNameForTheirs={() => activeDoctor.name}
            placeholder={`Message ${activeDoctor.name.split(' ')[1] ?? 'colleague'}…`}
          />
          </View>
        ) : null}
      </View>

      {newChatOpen ? (
        <NewChatSheet
          directory={directory}
          existingIds={new Set(threads.map((t) => t.id))}
          onClose={() => setNewChatOpen(false)}
          onSelectDoctor={openDoctorProfile}
        />
      ) : null}

      {referralDoctor ? (
        <ReferralWorkspace
          currentDoctor={currentDoctor}
          provider={referralDoctor}
          onClose={closeReferralFlow}
          onMessageDoctor={(doctor) => {
            closeReferralFlow();
            startOrOpenChat(doctor);
          }}
          onSaved={() => {
            setReferralSuccessMessage(
              `Consent email sent for referral to ${referralDoctor.name}. Waiting for the patient to approve or decline.`,
            );
          }}
        />
      ) : null}
    </View>
  );
}

function SpecialtyFilterMenu({
  specialties,
  selected,
  onSelect,
  onClose,
}: {
  specialties: string[];
  selected: string;
  onSelect: (specialty: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.filterMenuWrap} pointerEvents="box-none">
      <Pressable style={styles.filterDismiss} onPress={onClose} />
      <View style={styles.filterMenu}>
        <Text style={styles.filterMenuTitle}>Specialty</Text>
        <ScrollView style={styles.filterScroll} nestedScrollEnabled>
          {specialties.map((s) => {
            const active = s === selected;
            return (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(s)}
                style={[styles.filterOption, active && styles.filterOptionActive]}
              >
                <Text
                  style={[
                    styles.filterOptionText,
                    active && styles.filterOptionTextActive,
                  ]}
                >
                  {s}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

function DoctorList({
  threads,
  doctorName,
  statusMessage,
  specialtyFilter,
  onSelect,
  onNewChat,
}: {
  threads: DoctorThread[];
  doctorName: string;
  statusMessage: string | null;
  specialtyFilter: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  const filtered = useMemo(() => {
    if (specialtyFilter === 'All') return threads;
    return threads.filter((t) => t.specialty === specialtyFilter);
  }, [threads, specialtyFilter]);

  return (
    <View style={styles.flex}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.doctorList}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={Keyboard.dismiss}
      >
        <Text style={styles.listHint}>
          Doctor-to-doctor consults · {doctorName}
          {statusMessage ? ` · ${statusMessage}` : ''}
        </Text>
        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No chats in this specialty</Text>
            <Text style={styles.emptySub}>
              Tap + to start a new peer consult.
            </Text>
          </View>
        ) : (
          filtered.map((doc) => (
            <Pressable
              key={doc.id}
              accessibilityRole="button"
              accessibilityLabel={`Open chat with ${doc.name}`}
              onPress={() => {
                Keyboard.dismiss();
                onSelect(doc.id);
              }}
              style={styles.doctorCard}
            >
              <Avatar initials={doc.initials} color={doc.avatarColor} size={52} />
              <View style={styles.doctorMeta}>
                <Text style={styles.doctorName}>{doc.name}</Text>
                <Text style={styles.doctorDesignation}>{doc.designation}</Text>
                <Text style={styles.doctorPreview} numberOfLines={1}>
                  {doc.lastMessage}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start new doctor chat"
        onPress={onNewChat}
        style={styles.fab}
      >
        <PlusIcon color={colors.white} size={26} />
      </Pressable>
    </View>
  );
}

function NewChatSheet({
  directory,
  existingIds,
  onClose,
  onSelectDoctor,
}: {
  directory: DoctorProfile[];
  existingIds: Set<string>;
  onClose: () => void;
  onSelectDoctor: (doctor: DoctorProfile) => void;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    return searchDoctorsByNameOrSpecialization(directory, query);
  }, [directory, query]);

  return (
    <View style={styles.sheetRoot}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <View style={styles.sheetCard}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>New chat</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={styles.sheetClose}
          >
            <CloseIcon color={colors.textMuted} size={18} />
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <SearchIcon color={colors.searchPlaceholder} size={18} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or specialization"
            placeholderTextColor={colors.searchPlaceholder}
            onSubmitEditing={Keyboard.dismiss}
            autoFocus
          />
        </View>

        <Text style={styles.sheetSection}>Doctors</Text>
        <Text style={styles.sheetSectionHint}>
          Search by doctor name or specialization. Nearest doctors are shown first.
        </Text>

        <ScrollView
          style={styles.sheetList}
          contentContainerStyle={styles.sheetListContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={Keyboard.dismiss}
        >
          {results.map((doc) => {
            const hasChat = existingIds.has(doc.id);
            return (
              <Pressable
                key={doc.id}
                accessibilityRole="button"
                accessibilityLabel={`Start chat with ${doc.name}`}
                onPress={() => {
                  Keyboard.dismiss();
                  onSelectDoctor(doc);
                }}
                style={styles.sheetRow}
              >
                <Avatar
                  initials={doc.initials}
                  color={doc.avatarColor}
                  size={44}
                />
                <View style={styles.sheetRowMeta}>
                  <Text style={styles.sheetRowName}>{doc.name}</Text>
                  <Text style={styles.sheetRowSpecialty}>
                    {doc.specializations.join(' · ')}
                  </Text>
                  <Text style={styles.sheetRowDistance}>
                    {doc.distanceKm.toFixed(1)} km away · {doc.designation}
                  </Text>
                </View>
                {hasChat ? (
                  <Text style={styles.sheetRowBadge}>Open</Text>
                ) : (
                  <Text style={styles.sheetRowBadgeNew}>New</Text>
                )}
              </Pressable>
            );
          })}
          {results.length === 0 ? (
            <Text style={styles.sheetEmpty}>No doctors match that search.</Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    zIndex: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
    paddingVertical: 4,
    paddingRight: 12,
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 1,
  },
  chatHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatReferBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(123, 97, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(123, 97, 255, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatReferText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  chatAvatarButton: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  filterBtnActive: {
    backgroundColor: 'rgba(123, 97, 255, 0.28)',
  },
  body: {
    flex: 1,
  },
  profileContent: {
    paddingHorizontal: 16,
    paddingTop: 78,
    paddingBottom: 96,
    gap: 12,
  },
  successBanner: {
    backgroundColor: 'rgba(93, 200, 129, 0.2)',
    borderColor: 'rgba(93, 200, 129, 0.42)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 12,
  },
  successBannerClear: {
    marginBottom: 12,
    zIndex: 5,
  },
  successBannerText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  profileHeroCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 88,
    paddingBottom: 16,
    position: 'relative',
  },
  profileAvatarWrap: {
    position: 'absolute',
    top: -64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  profileHeroName: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  profileHeroMeta: {
    color: colors.accentPurple,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  profileDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(90,96,112,0.24)',
    marginTop: 14,
    marginBottom: 12,
  },
  profileSectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  profileDescription: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 6,
  },
  profileAddressLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 10,
  },
  profileAddressValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  profileDistanceNote: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  profileActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  profileActionPrimary: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#4A36A8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileActionPrimaryText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  profileActionSecondary: {
    flex: 1,
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: '#5C8A90',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileActionSecondaryText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  listHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  doctorList: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 96,
    gap: 12,
  },
  doctorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  doctorMeta: {
    flex: 1,
    minWidth: 0,
  },
  doctorName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  doctorDesignation: {
    fontSize: 13,
    color: colors.accentPurple,
    fontWeight: '600',
    marginTop: 2,
  },
  doctorPreview: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
  emptyCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    padding: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptySub: {
    marginTop: 6,
    fontSize: 14,
    color: colors.textMuted,
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: colors.accentPurple,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.45,
        shadowRadius: 8,
      },
      android: { elevation: 6 },
      web: {
        boxShadow: `0 6px 16px ${colors.accentPurple}88`,
      } as object,
      default: {},
    }),
  },
  filterMenuWrap: {
    ...StyleSheet.absoluteFill,
    zIndex: 40,
  },
  filterDismiss: {
    ...StyleSheet.absoluteFill,
  },
  filterMenu: {
    position: 'absolute',
    top: 64,
    right: 12,
    width: 220,
    maxHeight: 320,
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    padding: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: { elevation: 8 },
      web: {
        boxShadow: '0 10px 28px rgba(0,0,0,0.25)',
      } as object,
      default: {},
    }),
  },
  filterMenuTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  filterScroll: {
    maxHeight: 260,
  },
  filterOption: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  filterOptionActive: {
    backgroundColor: 'rgba(123, 97, 255, 0.12)',
  },
  filterOptionText: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  filterOptionTextActive: {
    color: colors.accentPurple,
    fontWeight: '700',
  },
  sheetRoot: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 60,
  },
  sheetOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheetCard: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '78%',
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sheetClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(138, 144, 160, 0.15)',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F2F3F7',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  sheetSection: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  sheetSectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  sheetList: {
    flexGrow: 0,
  },
  sheetListContent: {
    paddingBottom: 8,
    gap: 4,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  sheetRowMeta: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sheetRowSpecialty: {
    fontSize: 13,
    color: colors.accentPurple,
    fontWeight: '600',
    marginTop: 2,
  },
  sheetRowDistance: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  sheetRowBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  sheetRowBadgeNew: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accentPurple,
  },
  sheetEmpty: {
    textAlign: 'center',
    color: colors.textMuted,
    paddingVertical: 24,
    fontSize: 14,
  },
  sheetSubtext: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  patientPickerList: {
    maxHeight: 330,
  },
  patientPickerContent: {
    paddingBottom: 6,
    gap: 8,
  },
  patientSelectRow: {
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.24)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
  },
  patientSelectRowRelevant: {
    borderColor: '#E04848',
  },
  patientSelectMeta: {
    flex: 1,
    minWidth: 0,
  },
  patientSelectName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  patientSelectDx: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  relevantBadge: {
    color: '#E04848',
    fontSize: 11,
    fontWeight: '700',
  },
  confirmRoot: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: 70,
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  confirmCard: {
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
  },
  confirmTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
  },
  confirmText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  confirmActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(90,96,112,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  cancelBtnText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  referBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPurple,
  },
  referBtnText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
});
