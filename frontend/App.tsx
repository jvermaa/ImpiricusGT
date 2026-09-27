import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomNavBar, TabKey } from './src/components/BottomNavBar';
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
  const { width } = useWindowDimensions();
  const isWide = width > 768;

  const exitSuitableMode = () => {
    setSuitablePatientsMode(false);
    setSuitableSource(null);
  };

  const switchTab = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab !== 'patient') {
      exitSuitableMode();
    }
  };

  return (
    <DottedGradientBackground>
      <StatusBar style="light" />
      <View style={[styles.shell, isWide && styles.shellCentered]}>
        <View style={[styles.phoneFrame, isWide && styles.phoneFrameWide]}>
          <View style={styles.content}>
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
          <BottomNavBar activeTab={activeTab} onTabPress={switchTab} />
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
});
