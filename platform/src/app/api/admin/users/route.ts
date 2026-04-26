// =========================================================================
// Admin User Management API — List & Create Users
// =========================================================================
// GET  /api/admin/users     — List all admin users (requires users:manage)
// POST /api/admin/users     — Create a new admin user (requires users:manage)
//
// Only Super Admins (users:manage permission) can access these endpoints.
// When creating a user, a temporary password is auto-generated if not provided.
// New users always have mustSetup2FA=true, forcing 2FA setup on first login.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { MIN_PASSWORD_LENGTH } from '@streaming/shared';
import type { AdminRole } from '@streaming/shared';

/** Valid roles that can be assigned when creating/updating a user */
const VALID_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER_MANAGER', 'READ_ONLY'];

// ---- GET /api/admin/users — List all admin users (Super Admin only) ----
export async function GET() {
  const denied = await checkPermission('users:manage');
  if (denied) return denied;

  const users = await prisma.adminUser.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      totpEnabled: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ data: users });
}

// ---- POST /api/admin/users — Create a new admin user (Super Admin only) ----
export async function POST(request: NextRequest) {
  const denied = await checkPermission('users:manage');
  if (denied) return denied;

  const body = await request.json();
  const { email, password, role } = body as {
    email?: string;
    password?: string;
    role?: string;
  };

  // Validate email
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  // Validate role
  if (!role || !VALID_ROLES.includes(role as AdminRole)) {
    return NextResponse.json(
      { error: `Role must be one of: ${VALID_ROLES.join(', ')}` },
      { status: 400 },
    );
  }

  // If no password was provided, generate a secure random one.
  // The auto-generated password is returned in the response so the admin
  // can share it with the new user securely.
  const userPassword = password || generateTempPassword();
  if (userPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 },
    );
  }

  // Check for duplicate email before creating
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.adminUser.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(userPassword, 12);

  const { getSession } = await import('@/lib/admin-session');
  const session = await getSession();

  const user = await prisma.adminUser.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      role,
      mustSetup2FA: true,
      isActive: true,
      createdById: session.userId !== 'emergency' ? session.userId : null,
    },
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId: session.userId ?? null,
      action: 'user_created',
      details: JSON.stringify({ targetEmail: normalizedEmail, role }),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    },
  });

  return NextResponse.json({
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      // Return generated password if one was auto-generated
      temporaryPassword: !password ? userPassword : undefined,
    },
  }, { status: 201 });
}

function generateTempPassword(): string {
  // 16-char random base62 password
  const bytes = crypto.randomBytes(12);
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (const byte of bytes) {
    password += charset[byte % charset.length];
  }
  return password;
}
