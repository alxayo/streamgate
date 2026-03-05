import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/admin/tokens — List all tokens with filters
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get('eventId');
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const now = new Date();

  const where: Record<string, unknown> = {};

  if (eventId) {
    where.eventId = eventId;
  }

  if (status === 'revoked') {
    where.isRevoked = true;
  } else if (status === 'expired') {
    where.isRevoked = false;
    where.expiresAt = { lt: now };
  } else if (status === 'redeemed') {
    where.isRevoked = false;
    where.expiresAt = { gte: now };
    where.redeemedAt = { not: null };
  } else if (status === 'unused') {
    where.isRevoked = false;
    where.expiresAt = { gte: now };
    where.redeemedAt = null;
  }

  if (search) {
    where.OR = [
      { code: { contains: search } },
      { label: { contains: search } },
    ];
  }

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        event: { select: { title: true } },
      },
    }),
    prisma.token.count({ where }),
  ]);

  return NextResponse.json({
    data: tokens,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
