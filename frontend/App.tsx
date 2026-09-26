import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomNavBar, TabKey } from './src/components/BottomNavBar';
import { DottedGradientBackground } from './src/components/DottedGradientBackground';
import { ChatScreen } from './src/screens/ChatScreen';
<<<<<<< HEAD
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';

=======
import { PatientScreen } from './src/screens/PatientScreen';
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';

const TITLES: Record<Exclude<TabKey, 'chat' | 'patient'>, string> = {
  notification: 'Notification',
  profile: 'Profile',
};

>>>>>>> origin/main
function AppShell() {
  const [activeTab, setActiveTab] = useState<TabKey>('notification');
  const { width } = useWindowDimensions();
  const isWide = width > 768;

  return (
    <DottedGradientBackground>
      <StatusBar style="light" />
      <View style={[styles.shell, isWide && styles.shellCentered]}>
        <View style={[styles.phoneFrame, isWide && styles.phoneFrameWide]}>
          <View style={styles.content}>
            {activeTab === 'chat' ? (
              <ChatScreen />
<<<<<<< HEAD
            ) : activeTab === 'notification' ? (
              <NotificationsScreen
                onOpenPatient={() => setActiveTab('patient')}
              />
=======
            ) : activeTab === 'patient' ? (
              <PatientScreen />
>>>>>>> origin/main
            ) : (
              <PlaceholderScreen
                title={activeTab === 'profile' ? 'Profile' : 'Patient'}
              />
            )}
          </View>
          <BottomNavBar activeTab={activeTab} onTabPress={setActiveTab} />
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
