import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
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
import { ChevronLeftIcon, CloseIcon, SendIcon } from '../components/NavIcons';
import {
  NOTIFICATION_TYPE_META,
  NOTIFICATIONS,
  SUITABLE_PATIENTS,
  type AppNotification,
  type NotificationAction,
  type NotificationMessage,
  type SuitablePatient,
} from '../data/notificationsMock';
import { colors } from '../theme/colors';

type Props = {
  onOpenPatient?: () => void;
};

export function NotificationsScreen({ onOpenPatient }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState(NOTIFICATIONS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [patientsOpen, setPatientsOpen] = useState(false);
  const [patientDone, setPatientDone] = useState<Record<string, boolean>>({});

  const active = useMemo(
    () => items.find((n) => n.id === activeId) ?? null,
    [items, activeId],
  );

  const markRead = (id: string) => {
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, unread: 0 } : n)),
    );
  };

  const openNotification = (id: string) => {
    markRead(id);
    setActiveId(id);
  };

  const handleCardPress = (n: AppNotification) => {
    // Never open chat for link-only / match cards
    if (n.opensChat === false || n.findSuitablePatients) {
      if (n.linkUrl) {
        markRead(n.id);
        Linking.openURL(n.linkUrl).catch(() => undefined);
      }
      return;
    }
    openNotification(n.id);
  };

  const appendMessage = (text: string, from: 'me' | 'desk' = 'me') => {
    if (!activeId) return;
    const msg: NotificationMessage = {
      id: `local-${Date.now()}`,
      senderId: from,
      senderName: from === 'desk' ? 'Desk' : undefined,
      text,
      timestamp: 'Now',
    };
    setItems((prev) =>
      prev.map((n) =>
        n.id === activeId ? { ...n, messages: [...n.messages, msg] } : n,
      ),
    );
  };

  const runAction = (action: NotificationAction) => {
    appendMessage(action.label, 'me');
    const replies: Record<string, string> = {
      'req-2':
        'Request received — 2 boxes of Cardivex 10mg. Please confirm e-signature in the next step.',
      'req-4':
        'Request received — 4 boxes of Cardivex 10mg. Shipping label will generate after e-signature.',
      'not-now':
        'No problem. Samples will stay available for 7 days if you change your mind.',
      copay: 'Copay card drafted for J.M. — ready to send via Patient outreach.',
      pa: 'Prior authorization started for Glucora · J.M. I’ll ping you when the payer responds.',
      dismiss: 'Alert dismissed. You can reopen it from Patient · Rx alerts anytime.',
      affected:
        'Found 6 patients on BlueCross GA who may benefit from preferred Cardivex status.',
      'got-it':
        'Noted. We’ll keep coverage alerts quiet unless something material changes.',
      'in-person': 'In-person lunch-and-learn held for Thu. Alex will confirm the room.',
      virtual: 'Virtual 10-min call held. Calendar invite coming to your inbox.',
      ask: 'Sure — what would you like to ask the Lumaderm team?',
      'med-info':
        'Medical Information is on the thread. Ask anything about the new CKD indication.',
      samples: 'Sample request opened for Glucora. Concierge will follow up on quantity.',
      summarize:
        'AI summary: New CKD indication in T2D adults; continue renal & glycemic monitoring; review Full PI for fair balance.',
    };
    const reply = replies[action.id];
    if (reply) {
      setTimeout(() => appendMessage(reply, 'desk'), 350);
    }
  };

  if (active) {
    return (
      <NotificationDetail
        notification={active}
        topInset={Math.max(insets.top, 12)}
        onBack={() => setActiveId(null)}
        onSend={(text) => appendMessage(text, 'me')}
        onAction={runAction}
        onOpenPatient={
          active.patientLink && onOpenPatient ? () => onOpenPatient() : undefined
        }
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.listHeader, { paddingTop: Math.max(insets.top, 12) }]}>
        <Text style={styles.listTitle}>Notifications</Text>
        <Text style={styles.listSub}>Brand & access updates for your practice</Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {items.map((n) => {
          const meta = NOTIFICATION_TYPE_META[n.type];
          const isMatchCard = !!n.findSuitablePatients;

          return (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              accessibilityLabel={`${n.title}. ${n.preview}`}
              onPress={() => handleCardPress(n)}
              style={styles.card}
            >
              <View style={[styles.accent, { backgroundColor: meta.accent }]} />
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {n.title}
                  </Text>
                  <Text style={styles.timeAgo}>{n.timeAgo}</Text>
                </View>
                <Text style={styles.preview} numberOfLines={2}>
                  {n.preview}
                </Text>
                {isMatchCard ? (
                  <View style={styles.cardActionRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Find suitable patients"
                      onPress={(e) => {
                        // Don't also fire the card link redirect
                        e?.stopPropagation?.();
                        markRead(n.id);
                        setPatientsOpen(true);
                      }}
                      style={styles.findOnCardBtn}
                    >
                      <Text style={styles.findOnCardBtnText}>
                        Find suitable patients
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {patientsOpen ? (
        <SuitablePatientsPopup
          done={patientDone}
          onClose={() => setPatientsOpen(false)}
          onBulk={() => {
            setPatientDone(
              Object.fromEntries(SUITABLE_PATIENTS.map((p) => [p.id, true])),
            );
            setPatientsOpen(false);
          }}
          onPatient={(p) => {
            setPatientDone((prev) => ({ ...prev, [p.id]: true }));
          }}
        />
      ) : null}
    </View>
  );
}

function NotificationDetail({
  notification,
  topInset,
  onBack,
  onSend,
  onAction,
  onOpenPatient,
}: {
  notification: AppNotification;
  topInset: number;
  onBack: () => void;
  onSend: (text: string) => void;
  onAction: (action: NotificationAction) => void;
  onOpenPatient?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [selectedChip, setSelectedChip] = useState<string | null>(null);
  const [campaignChip, setCampaignChip] = useState<string | null>(null);
  const meta = NOTIFICATION_TYPE_META[notification.type];

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  const openLink = (url: string) => {
    onSend(`Opened ${url}`);
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <View style={[styles.detailHeader, { paddingTop: topInset }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to notifications"
          onPress={onBack}
          style={styles.backRow}
        >
          <ChevronLeftIcon color={colors.white} size={22} />
          <View style={styles.headerTitles}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {notification.title}
            </Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {notification.sender}
            </Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.threadContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.infoCard}>
            <View style={[styles.infoAccent, { backgroundColor: meta.accent }]} />
            <View style={styles.infoInner}>
              <Text style={styles.infoTitle}>{notification.infoCard.title}</Text>
              {notification.infoCard.bullets?.map((b) => (
                <Text key={b} style={styles.bullet}>
                  •  {b}
                </Text>
              ))}
              {notification.infoCard.sections.map((s) => (
                <View key={s.label} style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: meta.accent }]}>
                    {s.label}
                  </Text>
                  <Text style={styles.infoValue}>{s.value}</Text>
                </View>
              ))}
              {notification.infoCard.chips ? (
                <View style={styles.chipRow}>
                  {notification.infoCard.chips.map((chip) => {
                    const on = selectedChip === chip;
                    return (
                      <Pressable
                        key={chip}
                        onPress={() => setSelectedChip(chip)}
                        style={[styles.chip, on && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {chip}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {notification.infoCard.linkLabel ? (
                <Pressable>
                  <Text style={[styles.infoLink, { color: meta.accent }]}>
                    {notification.infoCard.linkLabel} →
                  </Text>
                </Pressable>
              ) : null}
              {notification.patientLink ? (
                <Pressable
                  onPress={onOpenPatient}
                  style={styles.patientChip}
                  accessibilityRole="button"
                  accessibilityLabel="Open patient"
                >
                  <View style={styles.patientInitials}>
                    <Text style={styles.patientInitialsText}>
                      {notification.patientLink.initials}
                    </Text>
                  </View>
                  <Text style={styles.patientChipLabel}>
                    {notification.patientLink.label}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {notification.messages.map((msg) => {
            const mine = msg.senderId === 'me';
            return (
              <View
                key={msg.id}
                style={[
                  styles.msgRow,
                  mine ? styles.msgRowMine : styles.msgRowTheirs,
                ]}
              >
                {!mine ? (
                  <View style={styles.msgMeta}>
                    <Avatar
                      initials={(msg.senderName ?? 'D')
                        .slice(0, 2)
                        .toUpperCase()}
                      color={meta.accent}
                      size={28}
                    />
                    <View>
                      <Text style={styles.msgName}>{msg.senderName}</Text>
                      {msg.senderRole ? (
                        <Text style={styles.msgRole}>{msg.senderRole}</Text>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                <View
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubbleTheirs,
                  ]}
                >
                  <Text
                    style={[styles.bubbleText, mine && styles.bubbleTextMine]}
                  >
                    {msg.text}
                  </Text>
                  <Text
                    style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}
                  >
                    {msg.timestamp}
                  </Text>
                </View>
              </View>
            );
          })}

          {notification.linkUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => openLink(notification.linkUrl!)}
              style={styles.linkBtn}
            >
              <Text style={styles.linkBtnText}>
                {notification.linkButtonLabel ?? 'Open link'}
              </Text>
              <Text style={styles.linkBtnUrl}>{notification.linkUrl}</Text>
            </Pressable>
          ) : null}

          {notification.replyPrompt ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDraft(notification.replyPrompt!);
                onSend(notification.replyPrompt!);
              }}
              style={styles.replyBtn}
            >
              <Text style={styles.replyBtnText}>
                Reply “{notification.replyPrompt}”
              </Text>
            </Pressable>
          ) : null}

          {notification.campaignChips?.length ? (
            <View style={styles.chipRow}>
              {notification.campaignChips.map((c) => {
                const on = campaignChip === c.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setCampaignChip(c.id);
                      onSend(c.label);
                    }}
                    style={[styles.campaignChip, on && styles.chipOn]}
                  >
                    <Text
                      style={[styles.campaignChipText, on && styles.chipTextOn]}
                    >
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <View style={styles.actionsWrap}>
            {notification.actions.map((action) => {
              const primary = action.style === 'primary';
              const secondary = action.style === 'secondary';
              return (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  onPress={() => onAction(action)}
                  style={[
                    styles.actionBtn,
                    primary && styles.actionPrimary,
                    secondary && styles.actionSecondary,
                    action.style === 'ghost' && styles.actionGhost,
                  ]}
                >
                  <Text
                    style={[
                      styles.actionText,
                      (primary || secondary) && styles.actionTextOnPurple,
                      action.style === 'ghost' && styles.actionTextGhost,
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message clinical desk…"
          placeholderTextColor={colors.searchPlaceholder}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={submit}
          style={[styles.sendBtn, !draft.trim() && styles.sendDisabled]}
        >
          <SendIcon color={colors.white} size={18} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function SuitablePatientsPopup({
  done,
  onClose,
  onBulk,
  onPatient,
}: {
  done: Record<string, boolean>;
  onClose: () => void;
  onBulk: () => void;
  onPatient: (p: SuitablePatient) => void;
}) {
  return (
    <View style={styles.popupRoot}>
      <Pressable style={styles.popupOverlay} onPress={onClose} />
      <View style={styles.popupCard}>
        <View style={styles.popupHeader}>
          <View style={styles.popupHeaderLeft}>
            <Text style={styles.popupTitle}>Suitable patients</Text>
            <Text style={styles.popupSub}>Cardivex 10mg · panel match</Text>
          </View>
          <View style={styles.popupHeaderRight}>
            <Pressable
              accessibilityRole="button"
              onPress={onBulk}
              style={styles.inviteAllBtn}
            >
              <Text style={styles.inviteAllText}>Invite/notify all</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.popupClose}
            >
              <CloseIcon color={colors.textMuted} size={16} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.popupList}
          contentContainerStyle={styles.popupListContent}
          showsVerticalScrollIndicator={false}
        >
          {SUITABLE_PATIENTS.map((p) => {
            const used = !!done[p.id];
            const label = p.cta === 'invite' ? 'Invite' : 'Notify';
            return (
              <View key={p.id} style={styles.popupRow}>
                <Avatar
                  initials={p.initials}
                  color={p.avatarColor}
                  size={40}
                />
                <View style={styles.popupRowMeta}>
                  <Text style={styles.popupRowName}>{p.name}</Text>
                  <Text style={styles.popupRowCond}>{p.condition}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={used}
                  onPress={() => onPatient(p)}
                  style={[
                    styles.rowCta,
                    p.cta === 'notify' && styles.rowCtaNotify,
                    used && styles.rowCtaDone,
                  ]}
                >
                  <Text
                    style={[
                      styles.rowCtaText,
                      p.cta === 'notify' && styles.rowCtaTextNotify,
                      used && styles.rowCtaTextDone,
                    ]}
                  >
                    {used ? 'Sent' : label}
                  </Text>
                </Pressable>
              </View>
            );
          })}
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
  listHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  listTitle: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '700',
  },
  listSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  accent: {
    width: 5,
  },
  cardBody: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  timeAgo: {
    fontSize: 12,
    color: colors.textMuted,
  },
  preview: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  cardActionRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  findOnCardBtn: {
    backgroundColor: colors.accentPurple,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  findOnCardBtnText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  detailHeader: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerTitles: {
    flex: 1,
  },
  headerTitle: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    marginTop: 1,
  },
  threadContent: {
    padding: 16,
    paddingBottom: 20,
    gap: 12,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: colors.cardBg,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 4,
  },
  infoAccent: {
    width: 5,
  },
  infoInner: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  bullet: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  infoRow: {
    gap: 2,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  infoValue: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  infoLink: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#F2F3F7',
  },
  chipOn: {
    backgroundColor: colors.accentPurple,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chipTextOn: {
    color: colors.white,
  },
  campaignChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1.5,
    borderColor: colors.accentPurple,
  },
  campaignChipText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: colors.accentPurple,
  },
  patientChip: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(123, 97, 255, 0.1)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    paddingRight: 14,
  },
  patientInitials: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patientInitialsText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '800',
  },
  patientChipLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentPurple,
  },
  msgRow: {
    marginBottom: 4,
  },
  msgRowMine: {
    alignItems: 'flex-end',
  },
  msgRowTheirs: {
    alignItems: 'flex-start',
  },
  msgMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  msgName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.white,
  },
  msgRole: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: {
    backgroundColor: colors.bubbleMine,
    borderBottomRightRadius: 6,
  },
  bubbleTheirs: {
    backgroundColor: colors.bubbleTheirs,
    borderBottomLeftRadius: 6,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  bubbleTextMine: {
    color: colors.white,
  },
  bubbleTime: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
  bubbleTimeMine: {
    color: 'rgba(255,255,255,0.7)',
  },
  linkBtn: {
    backgroundColor: colors.accentPurple,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 4,
  },
  linkBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  linkBtnUrl: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
  replyBtn: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.accentPurple,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  replyBtnText: {
    color: colors.accentPurple,
    fontSize: 15,
    fontWeight: '700',
  },
  actionsWrap: {
    marginTop: 8,
    gap: 8,
  },
  actionBtn: {
    borderRadius: 22,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  actionPrimary: {
    backgroundColor: colors.accentPurple,
  },
  actionSecondary: {
    backgroundColor: 'rgba(123, 97, 255, 0.85)',
  },
  actionGhost: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1.5,
    borderColor: colors.accentPurple,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionTextOnPurple: {
    color: colors.white,
  },
  actionTextGhost: {
    color: colors.accentPurple,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: colors.inputBg,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
    fontSize: 15,
    color: colors.textPrimary,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    opacity: 0.45,
  },
  popupRoot: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    paddingHorizontal: 18,
    zIndex: 80,
  },
  popupOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  popupCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 18,
    maxHeight: '72%',
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 12,
    zIndex: 81,
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  popupHeaderLeft: {
    flex: 1,
  },
  popupHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  popupTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  popupSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  inviteAllBtn: {
    backgroundColor: colors.accentPurple,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  inviteAllText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  popupClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(138, 144, 160, 0.15)',
  },
  popupList: {
    flexGrow: 0,
  },
  popupListContent: {
    gap: 8,
    paddingBottom: 4,
  },
  popupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  popupRowMeta: {
    flex: 1,
    minWidth: 0,
  },
  popupRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  popupRowCond: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowCta: {
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.accentPurple,
  },
  rowCtaNotify: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1.5,
    borderColor: colors.accentPurple,
  },
  rowCtaDone: {
    backgroundColor: '#E8EAF0',
    borderWidth: 0,
  },
  rowCtaText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
  },
  rowCtaTextNotify: {
    color: colors.accentPurple,
  },
  rowCtaTextDone: {
    color: colors.textMuted,
  },
});
