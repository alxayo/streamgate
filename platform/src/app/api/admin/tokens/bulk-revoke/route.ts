import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/admin/tokens/bulk-revoke
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { tokenIds } = body as { tokenIds?: string[] };

  if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
    return NextResponse.json({ error: 'tokenIds array is required' }, { status: 400 });
  }

  const result = await prisma.token.updateMany({
    where: { id: { in: tokenIds } },
    data: { isRevoked: true, revokedAt: new Date() },
  });

  return NextResponse.json({ data: { revokedCount: result.count } });
}
