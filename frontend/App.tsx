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
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';

function AppShell() {
  const [activeTab, setActiveTab] = useState<TabKey>('notification');
  const [suitablePatientsMode, setSuitablePatientsMode] = useState(false);
  const [suitableSource, setSuitableSource] = useState<AppNotification | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
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
    setActiveTab(tab);
    if (tab !== 'patient') exitSuitableMode();
  };

  return (
    <DottedGradientBackground variant={activeTab}>
      <StatusBar style={activeTab === 'profile' ? 'dark' : 'light'} />
      <View style={[styles.shell, isWide && styles.shellCentered]}>
        <View style={[styles.phoneFrame, isWide && styles.phoneFrameWide]}>
          <View style={[styles.content, keyboardVisible && styles.contentWithKeyboard]}>
            {activeTab === 'chat' ? (
              <ChatScreen />
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
              />
            ) : (
              <PlaceholderScreen title="Profile" />
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
    maxWidth: 430,
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
