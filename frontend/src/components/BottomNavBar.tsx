import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import {
  ChatIcon,
  ConciergeIcon,
  PrescriberIcon,
  ProfileIcon,
  TranslatorIcon,
} from './NavIcons';

export type TabKey =
  | 'prescriber'
  | 'translator'
  | 'concierge'
  | 'chat'
  | 'profile';

type TabDef = {
  key: TabKey;
  label: string;
  Icon: React.ComponentType<{ color: string; size?: number }>;
};

const TABS: TabDef[] = [
  { key: 'prescriber', label: 'Prescriber', Icon: PrescriberIcon },
  { key: 'translator', label: 'Translator', Icon: TranslatorIcon },
  { key: 'concierge', label: 'Concierge', Icon: ConciergeIcon },
  { key: 'chat', label: 'Chat', Icon: ChatIcon },
  { key: 'profile', label: 'Profile', Icon: ProfileIcon },
];

type Props = {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
};

export function BottomNavBar({ activeTab, onTabPress }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}
    >
      {TABS.map(({ key, label, Icon }) => {
        const active = key === activeTab;
        const color = active ? colors.navActive : colors.navInactive;

        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            onPress={() => onTabPress(key)}
            style={styles.item}
          >
            <View style={styles.iconSlot}>
              {active ? (
                <View style={styles.activeDot} />
              ) : (
                <View style={styles.dotSpacer} />
              )}
              <Icon color={color} size={22} />
            </View>
            <Text style={[styles.label, { color }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    backgroundColor: colors.navy,
    paddingTop: 8,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 3,
  },
  iconSlot: {
    height: 34,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: colors.accentPurple,
    marginBottom: 4,
    ...Platform.select({
      ios: {
        shadowColor: colors.accentPurple,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 5,
      },
      android: {
        elevation: 4,
        shadowColor: colors.accentPurple,
      },
      web: {
        boxShadow: `0 0 8px 2px ${colors.accentPurple}`,
      } as object,
      default: {},
    }),
  },
  dotSpacer: {
    width: 7,
    height: 7,
    marginBottom: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.05,
  },
});
