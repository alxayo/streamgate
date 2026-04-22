import { env } from './env';

/**
 * Probe the HLS server to determine if a stream is currently live (PDR §10.1).
 * Mints a short-lived probe JWT and sends a HEAD request to the manifest.
 */
export async function probeStreamLive(eventId: string): Promise<boolean> {
  try {
    // Import dynamically to avoid circular dependency
    const { mintProbeToken } = await import('./jwt');
    const probeJwt = await mintProbeToken(eventId);

    const manifestUrl = `${env.HLS_SERVER_BASE_URL}/streams/${eventId}/master.m3u8`;
    const response = await fetch(manifestUrl, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${probeJwt}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return false;

    // Check if manifest was recently modified
    const lastModified = response.headers.get('last-modified');
    if (lastModified) {
      const modifiedAt = new Date(lastModified);
      const ageMs = Date.now() - modifiedAt.getTime();
      // Consider live if modified in the last 60 seconds
      return ageMs < 60_000;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Determine event status using stream probing with time-based fallback (PDR §10.1).
 */
export async function getEventStatus(
  eventId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<'not-started' | 'live' | 'ended' | 'recording'> {
  const now = new Date();

  // Try stream probe first
  const isStreamActive = await probeStreamLive(eventId);

  if (isStreamActive) {
    return 'live';
  }

  // Fallback to time-based check
  if (now < startsAt) {
    return 'not-started';
  }

  if (now >= startsAt && now <= endsAt) {
    // Within scheduled window but stream not detected — could be live or not started
    // Fall back to 'live' during the scheduled window
    return 'live';
  }

  // After endsAt — check if content is still available for VOD
  return 'recording';
}
