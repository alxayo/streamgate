// =========================================================================
// Admin User Detail API — Get, Update, Deactivate Individual Users
// =========================================================================
// GET   /api/admin/users/:id — Get user details + recovery code count
// PATCH /api/admin/users/:id — Update role, active status, or reset password
//
// Safety guards:
//   - Cannot change your own role (prevents accidental self-demotion)
//   - Cannot deactivate your own account
//   - Cannot remove the last active Super Admin
//
// All changes are audit-logged with the acting admin's ID.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { getSession } from '@/lib/admin-session';
import { MIN_PASSWORD_LENGTH } from '@streaming/shared';
import type { AdminRole } from '@streaming/shared';

/** Valid roles for user creation/update */
const VALID_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER_MANAGER', 'READ_ONLY'];

// ---- GET /api/admin/users/:id — Get detailed user info ----
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkPermission('users:manage');
  if (denied) return denied;

  const { id } = await params;

  const user = await prisma.adminUser.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      totpEnabled: true,
      mustSetup2FA: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      createdBy: { select: { email: true } },
      _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      ...user,
      remainingRecoveryCodes: user._count.recoveryCodes,
      _count: undefined,
    },
  });
}

// ---- PATCH /api/admin/users/:id — Update user (role, active status, password) ----
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkPermission('users:manage');
  if (denied) return denied;

  const { id } = await params;
  const session = await getSession();
  const body = await request.json();
  const { role, isActive, newPassword } = body as {
    role?: string;
    isActive?: boolean;
    newPassword?: string;
  };

  const user = await prisma.adminUser.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Safety: prevent self-modification of role/active status to avoid
  // admins accidentally locking themselves out.
  if (id === session.userId) {
    if (role && role !== user.role) {
      return NextResponse.json(
        { error: 'Cannot change your own role' },
        { status: 400 },
      );
    }
    if (isActive === false) {
      return NextResponse.json(
        { error: 'Cannot deactivate your own account' },
        { status: 400 },
      );
    }
  }

  // Safety: ensure at least one active Super Admin always exists.
  // Without this check, the last Super Admin could be demoted/deactivated,
  // leaving no one able to manage users.
  if (user.role === 'SUPER_ADMIN' && (role !== 'SUPER_ADMIN' || isActive === false)) {
    const superAdminCount = await prisma.adminUser.count({
      where: { role: 'SUPER_ADMIN', isActive: true },
    });
    if (superAdminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last active Super Admin' },
        { status: 400 },
      );
    }
  }

  // Build the update payload dynamically — only include fields that were provided
  const updateData: Record<string, unknown> = {};

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role as AdminRole)) {
      return NextResponse.json(
        { error: `Role must be one of: ${VALID_ROLES.join(', ')}` },
        { status: 400 },
      );
    }
    updateData.role = role;
  }

  if (isActive !== undefined) {
    updateData.isActive = isActive;
  }

  if (newPassword) {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 },
      );
    }
    updateData.passwordHash = await bcrypt.hash(newPassword, 12);
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  await prisma.adminUser.update({ where: { id }, data: updateData });

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: session.userId ?? null,
      action: 'user_updated',
      details: JSON.stringify({
        targetUserId: id,
        targetEmail: user.email,
        changes: Object.keys(updateData).filter(k => k !== 'passwordHash'),
        passwordReset: !!newPassword,
      }),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    },
  });

  return NextResponse.json({ data: { success: true } });
}

// DELETE /api/admin/users/:id — Deactivate user (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkPermission('users:manage');
  if (denied) return denied;

  const { id } = await params;
  const session = await getSession();

  if (id === session.userId) {
    return NextResponse.json(
      { error: 'Cannot deactivate your own account' },
      { status: 400 },
    );
  }

  const user = await prisma.adminUser.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Ensure at least one Super Admin remains
  if (user.role === 'SUPER_ADMIN') {
    const superAdminCount = await prisma.adminUser.count({
      where: { role: 'SUPER_ADMIN', isActive: true },
    });
    if (superAdminCount <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last active Super Admin' },
        { status: 400 },
      );
    }
  }

  await prisma.adminUser.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.userId ?? null,
      action: 'user_deactivated',
      details: JSON.stringify({ targetUserId: id, targetEmail: user.email }),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    },
  });

  return NextResponse.json({ data: { success: true } });
}
