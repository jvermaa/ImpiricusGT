import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { SendIcon } from './NavIcons';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../data/chatMock';

type Props = {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  peerNameForTheirs?: (senderId: string) => string | undefined;
  placeholder?: string;
};

export function ChatThread({
  messages,
  onSend,
  peerNameForTheirs,
  placeholder = 'Type a message…',
}: Props) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.messageList}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((msg) => {
          const isMine = msg.senderId === 'me';
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isMine={isMine}
              showSenderLabel={
                !isMine && peerNameForTheirs
                  ? peerNameForTheirs(msg.senderId)
                  : undefined
              }
            />
          );
        })}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.searchPlaceholder}
          multiline
          onSubmitEditing={submit}
          blurOnSubmit={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          onPress={submit}
          style={[styles.sendBtn, !draft.trim() && styles.sendBtnDisabled]}
        >
          <SendIcon color={colors.white} size={18} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  messageList: {
    paddingTop: 12,
    paddingBottom: 8,
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
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
});
