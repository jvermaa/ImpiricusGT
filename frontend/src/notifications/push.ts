import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

export type PushBootstrap = {
  permission: Notifications.PermissionStatus | 'unsupported' | 'undetermined';
  expoPushToken: string | null;
  mode: 'remote' | 'local' | 'unsupported';
  hint: string;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function projectId(): string | undefined {
  return (
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined)
  );
}

export async function presentLocalNotification(input: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Delay in seconds so you can lock the phone before it appears. */
  delaySeconds?: number;
}): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const delay = input.delaySeconds ?? 0;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      sound: true,
    },
    trigger:
      delay > 0
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: delay,
            repeats: false,
          }
        : null,
  });
}

/** Friendly Duolingo-style nudges for the judge demo. */
export const DEMO_NUDGES = [
  { title: 'Impiricus', body: '💧 Drink some water — your patients need you sharp.' },
  { title: 'Impiricus', body: '🌬️ Take a deep breath. You’ve got this panel.' },
  { title: 'Impiricus', body: '🚶 Stand up and stretch for 30 seconds.' },
  { title: 'Impiricus', body: '👀 Quick eye break — look away from the screen.' },
  { title: 'Impiricus', body: '☕ Hydration check: refill that bottle.' },
  { title: 'Impiricus', body: '🧘 Two slow breaths before the next consult.' },
] as const;

export function nextDemoNudge(index: number): (typeof DEMO_NUDGES)[number] {
  return DEMO_NUDGES[index % DEMO_NUDGES.length];
}

/** Ask permission (if needed) then schedule one Duolingo-style nudge after `delaySeconds`. */
export async function scheduleStartupNudge(delaySeconds = 30): Promise<string | null> {
  const boot = await bootstrapPushNotifications();
  if (boot.permission !== 'granted') return null;
  const nudge = nextDemoNudge(Math.floor(Date.now() / 1000) % DEMO_NUDGES.length);
  return presentLocalNotification({
    title: nudge.title,
    body: nudge.body,
    data: { demo: true, kind: 'startup-nudge' },
    delaySeconds,
  });
}

export async function bootstrapPushNotifications(): Promise<PushBootstrap> {
  if (Platform.OS === 'web') {
    return {
      permission: 'unsupported',
      expoPushToken: null,
      mode: 'unsupported',
      hint: 'Open the app on your iPhone (Expo Go) to demo device notifications.',
    };
  }

  if (!Device.isDevice) {
    return {
      permission: 'undetermined',
      expoPushToken: null,
      mode: 'unsupported',
      hint: 'Push needs a physical iPhone — simulators cannot receive them.',
    };
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    status = asked.status;
  }

  if (status !== 'granted') {
    return {
      permission: status,
      expoPushToken: null,
      mode: 'unsupported',
      hint: 'Notification permission was denied. Enable it in iOS Settings to demo alerts.',
    };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Impiricus',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7B61FF',
    });
  }

  const easProjectId = projectId();
  let expoPushToken: string | null = null;
  let remoteError: string | null = null;

  if (easProjectId && /^[0-9a-f-]{36}$/i.test(easProjectId)) {
    try {
      const token = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
      expoPushToken = token.data;
    } catch (reason: unknown) {
      remoteError = reason instanceof Error ? reason.message : 'Could not fetch Expo push token.';
    }
  } else {
    remoteError =
      'Expo Go on SDK 53+ cannot receive remote push. Local alerts still work for the demo.';
  }

  if (expoPushToken) {
    return {
      permission: status,
      expoPushToken,
      mode: 'remote',
      hint: 'Remote Expo push is ready. Paste this token into expo.dev/notifications or let the backend send.',
    };
  }

  return {
    permission: status,
    expoPushToken: null,
    mode: 'local',
    hint: 'Tap a nudge below — lock your phone in 3 seconds to see it on the lock screen.',
  };
}
