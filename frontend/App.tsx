import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomNavBar, type TabKey } from './src/components/BottomNavBar';
import { DottedGradientBackground } from './src/components/DottedGradientBackground';
import type { AppNotification } from './src/data/notificationsMock';
import { ChatScreen } from './src/screens/ChatScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { PatientScreen } from './src/screens/PatientScreen';
import { CURRENT_DOCTOR_KEY } from './src/api/config';
import type { DirectoryFilter } from './src/api/directory';
import { ProfileScreen, type ProfileRoute } from './src/screens/ProfileScreen';

function AppShell() {
  const [activeTab, setActiveTab] = useState<TabKey>('notification');
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

  const exitSuitableMode = () => {
    setSuitablePatientsMode(false);
    setSuitableSource(null);
  };

  const switchTab = (tab: TabKey) => {
    if (tab === 'profile') {
      setProfileRoute({ name: 'card', doctorKey: CURRENT_DOCTOR_KEY });
    }
    setActiveTab(tab);
    if (tab !== 'patient') exitSuitableMode();
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
    <DottedGradientBackground variant={activeTab}>
      <StatusBar style={activeTab === 'profile' ? 'dark' : 'light'} />
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
