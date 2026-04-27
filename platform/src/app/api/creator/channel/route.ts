// =========================================================================
// Creator Channel API — GET (info) and PATCH (update)
// =========================================================================
// Returns and updates the creator's active channel details.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCreator } from '@/lib/creator-session';

// GET /api/creator/channel — Get channel info + stats
export async function GET() {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const channel = await prisma.channel.findUnique({
    where: { id: session.channelId },
    include: {
      _count: { select: { events: true } },
      events: {
        where: { isActive: true },
        select: {
          id: true,
          _count: { select: { tokens: true } },
        },
      },
    },
  });

  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  }

  const totalTokens = channel.events.reduce((sum, e) => sum + e._count.tokens, 0);

  return NextResponse.json({
    data: {
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      description: channel.description,
      logoUrl: channel.logoUrl,
      isActive: channel.isActive,
      createdAt: channel.createdAt,
      stats: {
        totalEvents: channel._count.events,
        totalTokens,
      },
    },
  });
}

// PATCH /api/creator/channel — Update channel details
export async function PATCH(request: NextRequest) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, logoUrl } = body;

  const data: Record<string, unknown> = {};

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Channel name must be at least 2 characters' }, { status: 400 });
    }
    data.name = name.trim();
  }
  if (description !== undefined) data.description = description || null;
  if (logoUrl !== undefined) {
    if (logoUrl && typeof logoUrl === 'string') {
      try { new URL(logoUrl); } catch { return NextResponse.json({ error: 'Invalid logo URL' }, { status: 400 }); }
    }
    data.logoUrl = logoUrl || null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const channel = await prisma.channel.update({
    where: { id: session.channelId },
    data,
  });

  return NextResponse.json({ data: channel });
}
