import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomNavBar, TabKey } from './src/components/BottomNavBar';
import { DottedGradientBackground } from './src/components/DottedGradientBackground';
import type { AppNotification } from './src/data/notificationsMock';
import { ChatScreen } from './src/screens/ChatScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { PatientScreen } from './src/screens/PatientScreen';
import { API_BASE_URL, CURRENT_DOCTOR_KEY } from './src/api/config';
import { registerPushToken } from './src/api/push';
import type { DirectoryFilter } from './src/api/directory';
import {
  bootstrapPushNotifications,
  presentLocalNotification,
  scheduleStartupNudge,
} from './src/notifications/push';
import { ProfileScreen, type ProfileRoute } from './src/screens/ProfileScreen';

function AppShell() {
  const [activeTab, setActiveTab] = useState<TabKey>('patient');
  const [suitablePatientsMode, setSuitablePatientsMode] = useState(false);
  const [suitableSource, setSuitableSource] = useState<AppNotification | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [profileRoute, setProfileRoute] = useState<ProfileRoute>({
    name: 'card',
    doctorKey: CURRENT_DOCTOR_KEY,
  });
  const [chatLaunch, setChatLaunch] = useState<{ peerKey: string | null; readOnlyReason?: string } | null>(null);
  const { width } = useWindowDimensions();
  const isWide = width > 768;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const seen = new Set<string>();

    bootstrapPushNotifications()
      .then(async (boot) => {
        if (cancelled) return;
        if (boot.expoPushToken) {
          try {
            await registerPushToken(boot.expoPushToken);
          } catch {
            // Best-effort for the demo.
          }
        }
        // Auto nudge for judges — fires ~30s after launch (lock the phone to see lock-screen).
        if (boot.permission === 'granted') {
          await scheduleStartupNudge(30);
        }
      })
      .catch(() => undefined);

    if (typeof EventSource === 'undefined') {
      return () => {
        cancelled = true;
      };
    }

    const source = new EventSource(`${API_BASE_URL}/events`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          type?: string;
          doctor_key?: string;
          notification_id?: string;
          title?: string;
          body?: string;
        };
        if (event.doctor_key && event.doctor_key !== CURRENT_DOCTOR_KEY) return;
        if (event.type !== 'doctor_notification' && event.type !== 'referral_consent') return;
        const key = event.notification_id ?? `${event.type}-${event.title}-${event.body}`;
        if (seen.has(key)) return;
        seen.add(key);
        void presentLocalNotification({
          title: event.title ?? 'Impiricus',
          body: event.body ?? 'You have a new update.',
          data: { notification_id: event.notification_id, type: event.type },
        });
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, []);

  const exitSuitableMode = () => {
    setSuitablePatientsMode(false);
    setSuitableSource(null);
  };

  const switchTab = (tab: TabKey) => {
    if (tab === 'profile') {
      setProfileRoute({ name: 'card', doctorKey: CURRENT_DOCTOR_KEY });
    }
    setActiveTab(tab);
    if (tab !== 'patient') {
      exitSuitableMode();
    }
  };

  const openDirectory = (filter: DirectoryFilter) => {
    setProfileRoute({ name: 'directory', filter });
    setActiveTab('profile');
  };

  const openReferrals = (direction: 'in' | 'out', withDoctor?: string) => {
    setProfileRoute({ name: 'referrals', direction, withDoctor });
    setActiveTab('profile');
  };

  const openConsults = (peerKey: string | null, readOnlyReason?: string) => {
    setChatLaunch({ peerKey, readOnlyReason });
    setActiveTab('chat');
  };

  return (
    <DottedGradientBackground>
      <StatusBar style="light" />
      <View style={[styles.shell, isWide && styles.shellCentered]}>
        <View style={[styles.phoneFrame, isWide && styles.phoneFrameWide]}>
          <View style={[styles.content, keyboardVisible && styles.contentWithKeyboard]}>
            {activeTab === 'chat' ? (
              <ChatScreen
                launch={chatLaunch}
                onLaunchHandled={() => setChatLaunch(null)}
                onOpenPatients={() => switchTab('patient')}
                onOpenReferrals={openReferrals}
                onOpenDirectory={openDirectory}
              />
            ) : activeTab === 'notification' ? (
              <NotificationsScreen
                onOpenPatient={() => switchTab('patient')}
                onFindSuitablePatients={(notification) => {
                  setSuitableSource(notification);
                  setSuitablePatientsMode(true);
                  setActiveTab('patient');
                }}
              />
            ) : activeTab === 'patient' ? (
              <PatientScreen
                suitableMode={suitablePatientsMode}
                suitableSource={suitableSource}
                onExitSuitableMode={exitSuitableMode}
                onOpenDirectory={openDirectory}
                onOpenReferrals={openReferrals}
              />
            ) : (
              <ProfileScreen
                route={profileRoute}
                onChangeRoute={setProfileRoute}
                onOpenPatients={() => switchTab('patient')}
                onOpenConsults={openConsults}
              />
            )}
          </View>
          {!keyboardVisible ? (
            <BottomNavBar activeTab={activeTab} onTabPress={switchTab} />
          ) : null}
        </View>
      </View>
    </DottedGradientBackground>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellCentered: {
    alignItems: 'center',
  },
  phoneFrame: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  phoneFrameWide: {
    maxWidth: 480,
    width: '100%',
  },
  content: {
    flex: 1,
    paddingBottom: 88,
  },
  contentWithKeyboard: {
    paddingBottom: 0,
  },
});
