import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/revocations — Internal endpoint for HLS server revocation sync
export async function GET(request: NextRequest) {
  // Authenticate with internal API key
  const apiKey = request.headers.get('x-internal-api-key');
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const since = searchParams.get('since');

  if (!since) {
    return NextResponse.json({ error: 'since parameter is required' }, { status: 400 });
  }

  const sinceDate = new Date(since);
  if (isNaN(sinceDate.getTime())) {
    return NextResponse.json({ error: 'Invalid since timestamp' }, { status: 400 });
  }

  // Get individually revoked tokens since timestamp
  const revokedTokens = await prisma.token.findMany({
    where: {
      isRevoked: true,
      revokedAt: { gt: sinceDate },
    },
    select: {
      code: true,
      revokedAt: true,
    },
  });

  // Get events deactivated since timestamp
  const deactivatedEvents = await prisma.event.findMany({
    where: {
      isActive: false,
      updatedAt: { gt: sinceDate },
    },
    select: {
      id: true,
      updatedAt: true,
      tokens: {
        select: { code: true },
      },
    },
  });

  return NextResponse.json({
    revocations: revokedTokens.map((t) => ({
      code: t.code,
      revokedAt: t.revokedAt!.toISOString(),
    })),
    eventDeactivations: deactivatedEvents.map((e) => ({
      eventId: e.id,
      deactivatedAt: e.updatedAt.toISOString(),
      tokenCodes: e.tokens.map((t) => t.code),
    })),
    serverTime: new Date().toISOString(),
  });
}
