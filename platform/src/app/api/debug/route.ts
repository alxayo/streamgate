import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Temporary debug endpoint — DELETE AFTER DEBUGGING
export async function GET(request: NextRequest) {
  const key = request.headers.get('x-debug-key');
  if (key !== 'rtmp-debug-2026') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const events = await prisma.event.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      title: true,
      rtmpToken: true,
      rtmpStreamKeyHash: true,
      rtmpTokenExpiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ events });
}
