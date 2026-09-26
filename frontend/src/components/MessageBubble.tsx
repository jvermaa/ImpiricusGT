import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import type { ChatMessage } from '../data/chatMock';

type Props = {
  message: ChatMessage;
  isMine: boolean;
  showSenderLabel?: string;
};

export function MessageBubble({ message, isMine, showSenderLabel }: Props) {
  return (
    <View
      style={[
        styles.row,
        isMine ? styles.rowMine : styles.rowTheirs,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isMine ? styles.bubbleMine : styles.bubbleTheirs,
        ]}
      >
        {showSenderLabel ? (
          <Text style={styles.senderLabel}>{showSenderLabel}</Text>
        ) : null}
        <Text style={[styles.text, isMine && styles.textMine]}>
          {message.text}
        </Text>
        <Text style={[styles.time, isMine && styles.timeMine]}>
          {message.timestamp}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  rowMine: {
    alignItems: 'flex-end',
  },
  rowTheirs: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
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
  senderLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accentPurple,
    marginBottom: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  textMine: {
    color: colors.white,
  },
  time: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
    alignSelf: 'flex-end',
  },
  timeMine: {
    color: 'rgba(255,255,255,0.7)',
  },
});
