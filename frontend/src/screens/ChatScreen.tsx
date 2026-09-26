import React, { useMemo, useState } from 'react';
import {
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
import { ChatThread } from '../components/ChatThread';
import {
  ChevronLeftIcon,
  CloseIcon,
  FilterIcon,
  PlusIcon,
  SearchIcon,
} from '../components/NavIcons';
import {
  CURRENT_DOCTOR,
  DOCTOR_DIRECTORY,
  DOCTOR_THREADS,
  SPECIALTIES,
  type ChatMessage,
  type DoctorProfile,
  type DoctorThread,
} from '../data/chatMock';
import { colors } from '../theme/colors';

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [activeDoctorId, setActiveDoctorId] = useState<string | null>(null);
  const [threads, setThreads] = useState<DoctorThread[]>(DOCTOR_THREADS);
  const [specialtyFilter, setSpecialtyFilter] = useState('All');
  const [filterOpen, setFilterOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const activeDoctor = useMemo(
    () => threads.find((t) => t.id === activeDoctorId) ?? null,
    [threads, activeDoctorId],
  );

  const showingList = !activeDoctor;

  const headerTitle = activeDoctor ? activeDoctor.name : 'Doctors';
  const headerSubtitle = activeDoctor
    ? activeDoctor.designation
    : specialtyFilter === 'All'
      ? 'Peer consults'
      : specialtyFilter;

  const startOrOpenChat = (doctor: DoctorProfile) => {
    setThreads((prev) => {
      const existing = prev.find((t) => t.id === doctor.id);
      if (existing) return prev;
      const fresh: DoctorThread = {
        ...doctor,
        lastMessage: 'New consult',
        messages: [],
      };
      return [fresh, ...prev];
    });
    setActiveDoctorId(doctor.id);
    setNewChatOpen(false);
    setFilterOpen(false);
  };

  const sendDoctor = (text: string) => {
    if (!activeDoctorId) return;
    const msg: ChatMessage = {
      id: `d-${Date.now()}`,
      senderId: 'me',
      text,
      timestamp: 'Now',
    };
    setThreads((prev) =>
      prev.map((t) =>
        t.id === activeDoctorId
          ? { ...t, messages: [...t.messages, msg], lastMessage: text }
          : t,
      ),
    );
  };

  const goBackToList = () => {
    setActiveDoctorId(null);
    setFilterOpen(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            activeDoctor ? 'Back to doctor list' : 'Doctors'
          }
          onPress={activeDoctor ? goBackToList : undefined}
          disabled={!activeDoctor}
          style={styles.headerLeft}
        >
          {activeDoctor ? (
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
          <Avatar
            initials={activeDoctor.initials}
            color={activeDoctor.avatarColor}
            size={36}
          />
        ) : null}
      </View>

      {showingList && filterOpen ? (
        <SpecialtyFilterMenu
          selected={specialtyFilter}
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
            specialtyFilter={specialtyFilter}
            onSelect={(id) => setActiveDoctorId(id)}
            onNewChat={() => {
              setFilterOpen(false);
              setNewChatOpen(true);
            }}
          />
        ) : activeDoctor ? (
          <ChatThread
            messages={activeDoctor.messages}
            onSend={sendDoctor}
            peerNameForTheirs={() => activeDoctor.name}
            placeholder={`Message ${activeDoctor.name.split(' ')[1] ?? 'colleague'}…`}
          />
        ) : null}
      </View>

      {newChatOpen ? (
        <NewChatSheet
          existingIds={new Set(threads.map((t) => t.id))}
          onClose={() => setNewChatOpen(false)}
          onSelectDoctor={startOrOpenChat}
        />
      ) : null}
    </View>
  );
}

function SpecialtyFilterMenu({
  selected,
  onSelect,
  onClose,
}: {
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
          {SPECIALTIES.map((s) => {
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
  specialtyFilter,
  onSelect,
  onNewChat,
}: {
  threads: DoctorThread[];
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
      >
        <Text style={styles.listHint}>
          Doctor-to-doctor consults · {CURRENT_DOCTOR.name}
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
              accessibilityLabel={`Chat with ${doc.name}`}
              onPress={() => onSelect(doc.id)}
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
  existingIds,
  onClose,
  onSelectDoctor,
}: {
  existingIds: Set<string>;
  onClose: () => void;
  onSelectDoctor: (doctor: DoctorProfile) => void;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DOCTOR_DIRECTORY.filter((d) => {
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        d.specialty.toLowerCase().includes(q) ||
        d.designation.toLowerCase().includes(q)
      );
    });
  }, [query]);

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
            placeholder="Search doctors"
            placeholderTextColor={colors.searchPlaceholder}
            autoFocus
          />
        </View>

        <Text style={styles.sheetSection}>Doctors</Text>

        <ScrollView
          style={styles.sheetList}
          contentContainerStyle={styles.sheetListContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {results.map((doc) => {
            const hasChat = existingIds.has(doc.id);
            return (
              <Pressable
                key={doc.id}
                accessibilityRole="button"
                accessibilityLabel={`Start chat with ${doc.name}`}
                onPress={() => onSelectDoctor(doc)}
                style={styles.sheetRow}
              >
                <Avatar
                  initials={doc.initials}
                  color={doc.avatarColor}
                  size={44}
                />
                <View style={styles.sheetRowMeta}>
                  <Text style={styles.sheetRowName}>{doc.name}</Text>
                  <Text style={styles.sheetRowSpecialty}>{doc.specialty}</Text>
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
    marginBottom: 8,
    letterSpacing: 0.3,
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
});
