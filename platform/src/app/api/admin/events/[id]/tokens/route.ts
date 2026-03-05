import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/admin/events/:id/tokens — List tokens for an event
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const now = new Date();

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const where: Record<string, unknown> = { eventId };

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
    where.OR = [{ code: { contains: search } }, { label: { contains: search } }];
  }

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.token.count({ where }),
  ]);

  return NextResponse.json({
    data: tokens,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
