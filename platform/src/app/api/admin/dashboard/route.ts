import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

// Force dynamic rendering — these API routes need the database
export const dynamic = 'force-dynamic';

// GET /api/admin/dashboard — Dashboard summary statistics
export async function GET() {
  const now = new Date();
  const heartbeatCutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);

  const [activeEvents, totalTokens, tokensByStatus, upcomingEvents, activeSessionRows] = await Promise.all([
    prisma.event.count({ where: { isActive: true, isArchived: false } }),
    prisma.token.count(),
    prisma.token.findMany({
      select: { isRevoked: true, redeemedAt: true, expiresAt: true },
    }),
    prisma.event.findMany({
      where: { startsAt: { gt: now }, isActive: true, isArchived: false },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: { id: true, title: true, startsAt: true },
    }),
    // Active sessions with event info for viewer stats
    prisma.activeSession.findMany({
      where: { lastHeartbeat: { gte: heartbeatCutoff } },
      select: {
        token: {
          select: {
            event: {
              select: { id: true, title: true, streamType: true },
            },
          },
        },
      },
    }),
  ]);

  const breakdown = { unused: 0, redeemed: 0, expired: 0, revoked: 0 };
  for (const token of tokensByStatus) {
    if (token.isRevoked) {
      breakdown.revoked++;
    } else if (token.expiresAt < now) {
      breakdown.expired++;
    } else if (token.redeemedAt) {
      breakdown.redeemed++;
    } else {
      breakdown.unused++;
    }
  }

  // Aggregate active viewers per event
  const totalActiveViewers = activeSessionRows.length;
  const eventViewerMap = new Map<string, { title: string; streamType: string; viewers: number }>();
  for (const row of activeSessionRows) {
    const evt = row.token.event;
    const existing = eventViewerMap.get(evt.id);
    if (existing) {
      existing.viewers++;
    } else {
      eventViewerMap.set(evt.id, { title: evt.title, streamType: evt.streamType, viewers: 1 });
    }
  }
  const liveNowEvents = Array.from(eventViewerMap.entries())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.viewers - a.viewers);

  return NextResponse.json({
    data: {
      activeEvents,
      totalTokens,
      totalActiveViewers,
      tokenBreakdown: breakdown,
      upcomingEvents,
      liveNowEvents,
    },
  });
}
