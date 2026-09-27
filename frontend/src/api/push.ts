import { API_BASE_URL, CURRENT_DOCTOR_KEY } from './config';

const headers = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

export async function registerPushToken(token: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/notifications/push-token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      doctor_key: CURRENT_DOCTOR_KEY,
      token,
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not register push token (${response.status}).`);
  }
}

export async function requestDemoPush(input?: {
  title?: string;
  body?: string;
}): Promise<{ delivered: boolean; mode: string; detail: string }> {
  const response = await fetch(`${API_BASE_URL}/notifications/demo-push`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      doctor_key: CURRENT_DOCTOR_KEY,
      title: input?.title,
      body: input?.body,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Demo push failed (${response.status}).`);
  }
  return (await response.json()) as { delivered: boolean; mode: string; detail: string };
}
