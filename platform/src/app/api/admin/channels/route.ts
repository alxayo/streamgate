// =========================================================================
// Admin Channels API — GET (list all)
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';

// GET /api/admin/channels — List all channels
export async function GET(request: NextRequest) {
  const denied = await checkPermission('channels:view');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search');
  const status = searchParams.get('status');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const where: Record<string, unknown> = {};

  if (status === 'active') where.isActive = true;
  else if (status === 'suspended') where.isActive = false;

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { slug: { contains: search } },
    ];
  }

  const [channels, total] = await Promise.all([
    prisma.channel.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        creator: { select: { id: true, email: true, displayName: true } },
        _count: { select: { events: true } },
      },
    }),
    prisma.channel.count({ where }),
  ]);

  return NextResponse.json({
    data: channels,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
