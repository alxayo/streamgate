import type {
  TokenValidationResponse,
  TokenRefreshResponse,
  HeartbeatResponse,
  EventStatusResponse,
} from '@streaming/shared';

async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }));
    const error = new Error(body.error || `HTTP ${response.status}`);
    (error as Error & { status: number }).status = response.status;
    (error as Error & { body: unknown }).body = body;
    throw error;
  }

  return response.json() as Promise<T>;
}

export async function validateToken(code: string): Promise<TokenValidationResponse> {
  return fetchApi<TokenValidationResponse>('/api/tokens/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export async function refreshPlaybackToken(jwt: string): Promise<TokenRefreshResponse> {
  return fetchApi<TokenRefreshResponse>('/api/playback/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

export async function sendHeartbeat(jwt: string): Promise<HeartbeatResponse> {
  return fetchApi<HeartbeatResponse>('/api/playback/heartbeat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

export async function releaseSession(jwt: string): Promise<void> {
  // Use sendBeacon if available, otherwise fetch with keepalive
  const body = '';
  const headers = { Authorization: `Bearer ${jwt}` };

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    // sendBeacon doesn't support custom headers, fall back to fetch with keepalive
    fetch('/api/playback/release', {
      method: 'POST',
      headers,
      keepalive: true,
    }).catch(() => {
      // Fire and forget
    });
    return;
  }

  fetch('/api/playback/release', {
    method: 'POST',
    headers,
    body,
    keepalive: true,
  }).catch(() => {
    // Fire and forget
  });
}

export async function getEventStatus(
  eventId: string,
  code: string,
): Promise<EventStatusResponse> {
  return fetchApi<EventStatusResponse>(`/api/events/${eventId}/status?code=${encodeURIComponent(code)}`);
}
