// =========================================================================
// Admin Creators API — GET (list all) 
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';

// GET /api/admin/creators — List all creators
export async function GET(request: NextRequest) {
  const denied = await checkPermission('creators:view');
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
      { email: { contains: search } },
      { displayName: { contains: search } },
    ];
  }

  const [creators, total] = await Promise.all([
    prisma.creator.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { channels: true } },
        channels: { select: { id: true, name: true, slug: true, isActive: true } },
      },
    }),
    prisma.creator.count({ where }),
  ]);

  // Strip passwordHash from response
  const safeCreators = creators.map(({ passwordHash: _, totpSecret: _t, ...rest }) => rest);

  return NextResponse.json({
    data: safeCreators,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
