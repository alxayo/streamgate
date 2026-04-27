// =========================================================================
// Admin Channel by ID — GET, PATCH (suspend/unsuspend)
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/admin/channels/:id — Get channel details
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await checkPermission('channels:view');
  if (denied) return denied;

  const { id } = await params;

  const channel = await prisma.channel.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, email: true, displayName: true, isActive: true } },
      events: {
        orderBy: { startsAt: 'desc' },
        take: 10,
        select: { id: true, title: true, startsAt: true, isActive: true, _count: { select: { tokens: true } } },
      },
      _count: { select: { events: true } },
    },
  });

  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }

  return NextResponse.json({ data: channel });
}

// PATCH /api/admin/channels/:id — Suspend/unsuspend channel
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await checkPermission('channels:manage');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const { isActive } = body;

  if (typeof isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 });
  }

  const channel = await prisma.channel.update({
    where: { id },
    data: { isActive },
  });

  return NextResponse.json({ data: channel });
}
