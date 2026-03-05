import crypto from 'node:crypto';
import { prisma } from './prisma';
import { env } from './env';

/**
 * Check if a token has an active viewing session (PDR §5.3).
 * A session is active if its lastHeartbeat is within SESSION_TIMEOUT_SECONDS.
 */
export async function getActiveSession(tokenId: string) {
  const cutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);
  return prisma.activeSession.findFirst({
    where: {
      tokenId,
      lastHeartbeat: { gte: cutoff },
    },
  });
}

/**
 * Create a new active session for a token.
 * Cleans up any stale sessions for the same token first.
 */
export async function createSession(
  tokenId: string,
  clientIp: string,
  userAgent?: string,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const cutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);

  await prisma.$transaction([
    // Clean up stale sessions for this token
    prisma.activeSession.deleteMany({
      where: { tokenId, lastHeartbeat: { lt: cutoff } },
    }),
    // Create new session
    prisma.activeSession.create({
      data: { tokenId, sessionId, clientIp, userAgent },
    }),
  ]);

  return sessionId;
}

/**
 * Update session heartbeat timestamp.
 */
export async function updateHeartbeat(sessionId: string) {
  return prisma.activeSession.update({
    where: { sessionId },
    data: { lastHeartbeat: new Date() },
  });
}

/**
 * Release (delete) an active session.
 */
export async function releaseSession(sessionId: string) {
  return prisma.activeSession.delete({
    where: { sessionId },
  });
}
