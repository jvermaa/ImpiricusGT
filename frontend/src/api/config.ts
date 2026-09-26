import { NativeModules, Platform } from 'react-native';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
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
    if (hostMatch?.[1]) {
      return `http://${hostMatch[1]}:8000`;
    }
  }

  return 'http://localhost:8000';
}

export const API_BASE_URL = inferApiBaseUrl();

/** Dr. Jordan Morgan in data/doctors.json. This doctor accepts peer consults. */
export const CURRENT_DOCTOR_KEY = 'D002';
