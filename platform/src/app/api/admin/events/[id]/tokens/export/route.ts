import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/admin/events/:id/tokens/export — Export tokens as CSV
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const tokens = await prisma.token.findMany({
    where: { eventId },
    orderBy: { createdAt: 'asc' },
  });

  const now = new Date();
  const csvRows = ['Code,Event Title,Expires At,Label,Status'];

  for (const token of tokens) {
    let status: string;
    if (token.isRevoked) {
      status = 'revoked';
    } else if (token.expiresAt < now) {
      status = 'expired';
    } else if (token.redeemedAt) {
      status = 'redeemed';
    } else {
      status = 'unused';
    }

    const row = [
      token.code,
      `"${event.title.replace(/"/g, '""')}"`,
      token.expiresAt.toISOString(),
      token.label ? `"${token.label.replace(/"/g, '""')}"` : '',
      status,
    ].join(',');

    csvRows.push(row);
  }

  const csv = csvRows.join('\n');
  const safeTitle = event.title.replace(/[^a-zA-Z0-9-_]/g, '_');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="tokens-${safeTitle}.csv"`,
    },
  });
}
