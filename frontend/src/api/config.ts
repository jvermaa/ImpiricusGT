import { NativeModules, Platform } from 'react-native';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isTunnelHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower.includes('exp.direct') ||
    lower.includes('expo.dev') ||
    lower.includes('ngrok') ||
    lower.endsWith('.exp.host')
  );
}

function inferApiBaseUrl(): string {
  const explicitUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicitUrl) {
    return trimTrailingSlash(explicitUrl);
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  const scriptUrl = NativeModules?.SourceCode?.scriptURL as string | undefined;
  if (scriptUrl) {
    const hostMatch = scriptUrl.match(/^[a-z]+:\/\/([^/:]+)/i);
    const host = hostMatch?.[1];
    // Expo --tunnel uses exp.direct for Metro JS, not your FastAPI server.
    if (host && !isTunnelHost(host)) {
      return `http://${host}:8000`;
    }
  }

  return 'http://localhost:8000';
}

export const API_BASE_URL = inferApiBaseUrl();

/** Signed-in HCP: Dr. Aisha Reed in data/doctors.json. */
export const CURRENT_DOCTOR_KEY = 'D031';
