import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Force dynamic rendering — these API routes need the database
export const dynamic = 'force-dynamic';

// GET /api/admin/dashboard — Dashboard summary statistics
export async function GET() {
  const now = new Date();

  const [activeEvents, totalTokens, tokensByStatus, upcomingEvents] = await Promise.all([
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

  return NextResponse.json({
    data: {
      activeEvents,
      totalTokens,
      tokenBreakdown: breakdown,
      upcomingEvents,
    },
  });
}
