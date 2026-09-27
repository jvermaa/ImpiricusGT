import { API_BASE_URL, CURRENT_DOCTOR_KEY } from './config';
import type { AppNotification, NotificationMessage } from '../data/notificationsMock';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    let detail = `API ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) detail = payload.detail;
    } catch {
      // Keep status-only message when body isn't JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function normalize(row: AppNotification): AppNotification {
  return {
    ...row,
    actions: row.actions ?? [],
    messages: row.messages ?? [],
    campaignChips: row.campaignChips ?? [],
    findSuitablePatients: !!row.findSuitablePatients,
    opensChat: row.findSuitablePatients ? false : row.opensChat !== false,
    infoCard: row.infoCard ?? { title: row.title, sections: [] },
  };
}

export async function loadMyNotifications(): Promise<AppNotification[]> {
  const rows = await requestJson<AppNotification[]>(
    `/notifications?doctor=${encodeURIComponent(CURRENT_DOCTOR_KEY)}`,
  );
  return rows.map(normalize);
}

export async function markNotificationRead(notificationId: string): Promise<AppNotification> {
  return normalize(
    await requestJson<AppNotification>(
      `/notifications/${encodeURIComponent(notificationId)}/read?doctor=${encodeURIComponent(CURRENT_DOCTOR_KEY)}`,
      { method: 'POST' },
    ),
  );
}

export async function postNotificationMessage(
  notificationId: string,
  text: string,
  senderId: 'me' | 'desk' = 'me',
): Promise<{ notification: AppNotification; message: NotificationMessage }> {
  const response = await requestJson<{
    notification: AppNotification;
    message: NotificationMessage;
  }>(
    `/notifications/${encodeURIComponent(notificationId)}/messages?doctor=${encodeURIComponent(CURRENT_DOCTOR_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sender_id: senderId,
        sender_name: senderId === 'desk' ? 'Desk' : undefined,
      }),
    },
  );
  return {
    notification: normalize(response.notification),
    message: response.message,
  };
}
