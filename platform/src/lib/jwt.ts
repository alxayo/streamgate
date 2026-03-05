import { SignJWT, jwtVerify } from 'jose';
import type { PlaybackTokenClaims } from '@streaming/shared';
import {
  JWT_EXPIRY_SECONDS,
  PROBE_JWT_EXPIRY_SECONDS,
  JWT_ALGORITHM,
  buildStreamPathPrefix,
} from '@streaming/shared';
import { env } from './env';

const secret = new TextEncoder().encode(env.PLAYBACK_SIGNING_SECRET);

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
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [JWT_ALGORITHM],
  });
  return payload as unknown as PlaybackTokenClaims;
}
