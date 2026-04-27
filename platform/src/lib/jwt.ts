import { SignJWT, jwtVerify } from 'jose';
import type { PlaybackTokenClaims } from '@streaming/shared';
import {
  JWT_EXPIRY_SECONDS,
  PROBE_JWT_EXPIRY_SECONDS,
  JWT_ALGORITHM,
  buildStreamPathPrefix,
} from '@streaming/shared';
import { prisma } from './prisma';
import { requireConfigValue, CONFIG_KEYS } from './system-config';

// Cached signing secret (resolved once per process lifetime)
let _cachedSecret: Uint8Array | null = null;

async function getSigningSecret(): Promise<Uint8Array> {
  if (_cachedSecret) return _cachedSecret;
  const signingSecret = await requireConfigValue(prisma, CONFIG_KEYS.PLAYBACK_SIGNING_SECRET);
  _cachedSecret = new TextEncoder().encode(signingSecret);
  return _cachedSecret;
}

/**
 * Mint a playback JWT for a validated token (PDR §4.3).
 * Includes session ID for single-device enforcement.
 */
export async function mintPlaybackToken(
  code: string,
  eventId: string,
  sessionId: string,
): Promise<{ token: string; expiresIn: number }> {
  const sp = buildStreamPathPrefix(eventId);
  const secret = await getSigningSecret();
  const token = await new SignJWT({
    sub: code,
    eid: eventId,
    sid: sessionId,
    sp,
  } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRY_SECONDS}s`)
    .sign(secret);

  return { token, expiresIn: JWT_EXPIRY_SECONDS };
}

/**
 * Mint a short-lived probe JWT for stream status checking (PDR §10.1).
 */
export async function mintProbeToken(eventId: string): Promise<string> {
  const secret = await getSigningSecret();
  const sp = buildStreamPathPrefix(eventId);
  return new SignJWT({
    eid: eventId,
    sp,
    probe: true,
  } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${PROBE_JWT_EXPIRY_SECONDS}s`)
    .sign(secret);
}

/**
 * Verify and decode a playback JWT.
 */
export async function verifyPlaybackToken(token: string): Promise<PlaybackTokenClaims> {
  const signingSecret = await getSigningSecret();
  const { payload } = await jwtVerify(token, signingSecret, {
    algorithms: [JWT_ALGORITHM],
  });
  return payload as unknown as PlaybackTokenClaims;
}
