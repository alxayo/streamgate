import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';

// DELETE removes a single rule, but only if it belongs to the event in the URL.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const denied = await checkPermission('events:edit');
  if (denied) return denied;

  const { id: eventId, entryId } = await params;
  // The ownership check prevents deleting another event's rule by guessing its ID.
  const entry = await prisma.rtmpPlayAllowlistEntry.findFirst({
    where: { id: entryId, eventId },
    select: { id: true },
  });

  if (!entry) return NextResponse.json({ error: 'Allow-list entry not found' }, { status: 404 });

  await prisma.rtmpPlayAllowlistEntry.delete({ where: { id: entryId } });
  return new NextResponse(null, { status: 204 });
}