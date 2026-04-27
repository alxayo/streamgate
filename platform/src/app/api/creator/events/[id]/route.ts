// =========================================================================
// Creator Event by ID — GET, PATCH, DELETE
// =========================================================================
// All operations scoped to the creator's channel (cannot access other channels' events).
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCreator } from '@/lib/creator-session';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/creator/events/:id — Get a single event
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const event = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
    include: { _count: { select: { tokens: true } } },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  return NextResponse.json({ data: event });
}

// PATCH /api/creator/events/:id — Update event fields
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const body = await request.json();
  const { title, description, streamUrl, posterUrl, startsAt, endsAt, accessWindowHours, isActive } = body;

  const data: Record<string, unknown> = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    data.title = title.trim();
  }
  if (description !== undefined) data.description = description || null;
  if (streamUrl !== undefined) {
    if (streamUrl && typeof streamUrl === 'string') {
      try { new URL(streamUrl); } catch { return NextResponse.json({ error: 'Invalid stream URL' }, { status: 400 }); }
    }
    data.streamUrl = streamUrl || null;
  }
  if (posterUrl !== undefined) data.posterUrl = posterUrl || null;
  if (startsAt !== undefined) data.startsAt = new Date(startsAt);
  if (endsAt !== undefined) data.endsAt = new Date(endsAt);
  if (accessWindowHours !== undefined) data.accessWindowHours = accessWindowHours;
  if (typeof isActive === 'boolean') data.isActive = isActive;

  const event = await prisma.event.update({ where: { id }, data });

  return NextResponse.json({ data: event });
}

// DELETE /api/creator/events/:id — Soft-delete (deactivate) an event
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  await prisma.event.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
