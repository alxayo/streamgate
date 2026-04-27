// =========================================================================
// Admin Creator by ID — GET, PATCH (suspend/unsuspend)
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/admin/creators/:id — Get creator details
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await checkPermission('creators:view');
  if (denied) return denied;

  const { id } = await params;

  const creator = await prisma.creator.findUnique({
    where: { id },
    include: {
      channels: {
        include: { _count: { select: { events: true } } },
      },
    },
  });

  if (!creator) {
    return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
  }

  const { passwordHash: _, totpSecret: _t, ...safe } = creator;
  return NextResponse.json({ data: safe });
}

// PATCH /api/admin/creators/:id — Suspend/unsuspend, approve, or unlock a creator
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const denied = await checkPermission('creators:manage');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json();
  const { isActive, approve, unlock } = body;

  const updateData: Record<string, unknown> = {};

  // Approve a pending creator (activates account + clears pending flag)
  if (approve === true) {
    updateData.isActive = true;
    updateData.isPendingApproval = false;
  }

  // Unlock a locked-out account (resets lockout timer + failed attempts)
  if (unlock === true) {
    updateData.failedLoginAttempts = 0;
    updateData.lockedUntil = null;
  }

  // Suspend/unsuspend
  if (typeof isActive === 'boolean') {
    updateData.isActive = isActive;
    if (isActive) updateData.isPendingApproval = false; // unsuspending also clears pending
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No valid update fields provided' }, { status: 400 });
  }

  const creator = await prisma.creator.update({
    where: { id },
    data: updateData,
  });

  const { passwordHash: _, totpSecret: _t, ...safe } = creator;
  return NextResponse.json({ data: safe });
}
