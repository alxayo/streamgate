// =========================================================================
// GET /api/admin/audit-log — Paginated Audit Log Viewer
// =========================================================================
// Returns audit log entries with optional filtering by action type and user.
// Used by the Audit Log page in the admin UI (Super Admin only).
//
// Query parameters:
//   ?action=login         — Filter by action type (exact match)
//   ?userId=<uuid>        — Filter by acting user
//   ?page=1&limit=50      — Pagination (defaults: page 1, 50 entries per page)
//
// Returns parsed JSON details and includes the user's email via a join.
// Requires: 'audit:view' permission (Super Admin role)
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
export async function GET(request: NextRequest) {
  const denied = await checkPermission('audit:view');
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const where: Record<string, unknown> = {};

  if (action) {
    where.action = action;
  }
  if (userId) {
    where.userId = userId;
  }

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    data: entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      userEmail: e.user?.email ?? null,
      action: e.action,
      details: e.details ? JSON.parse(e.details) : null,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt.toISOString(),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
