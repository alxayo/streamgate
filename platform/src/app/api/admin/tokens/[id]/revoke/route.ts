import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// PATCH /api/admin/tokens/:id/revoke
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const token = await prisma.token.findUnique({ where: { id } });

  if (!token) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  const updated = await prisma.token.update({
    where: { id },
    data: { isRevoked: true, revokedAt: new Date() },
  });

  return NextResponse.json({ data: updated });
}
