import { NativeModules, Platform } from 'react-native';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function inferLocalApiBaseUrl(): string {
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

const explicitUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const inferredLocal = trimTrailingSlash(inferLocalApiBaseUrl());

export const API_BASE_URL = explicitUrl ? trimTrailingSlash(explicitUrl) : inferredLocal;
export const FALLBACK_API_BASE_URL =
  explicitUrl && trimTrailingSlash(explicitUrl) !== inferredLocal ? inferredLocal : null;

/** Signed-in HCP: Dr. Aisha Reed in data/doctors.json. */
export const CURRENT_DOCTOR_KEY = 'D031';
