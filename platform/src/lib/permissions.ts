// =========================================================================
// Role-Based Access Control (RBAC) — Permission Matrix
// =========================================================================
// Defines which permissions each admin role has. This is the single source of
// truth for authorization decisions. The hierarchy is:
//
//   SUPER_ADMIN  — Everything + users:manage + audit:view
//   ADMIN        — Everything except user management and audit log
//   OPERATOR     — View events/tokens, manage viewers, view dashboard
//   VIEWER_MANAGER — Create/revoke tokens, view events/dashboard
//   READ_ONLY    — View events, tokens, and dashboard only
//
// To add a new permission:
//   1. Add it to the Permission type union below
//   2. Add it to the appropriate roles in ROLE_PERMISSIONS
//   3. Use checkPermission() in the API route (see require-permission.ts)
// =========================================================================

import type { AdminRole } from '@streaming/shared';

/**
 * All possible permissions in the system.
 * Format: "resource:action" (e.g., "events:create", "users:manage")
 */
export type Permission =
  | 'users:manage'
  | 'events:create'
  | 'events:edit'
  | 'events:delete'
  | 'events:view'
  | 'tokens:create'
  | 'tokens:revoke'
  | 'tokens:view'
  | 'settings:manage'
  | 'viewers:manage'
  | 'dashboard:view'
  | 'audit:view';

/**
 * Maps each role to its allowed permissions.
 * This is the authoritative permission matrix — all authorization checks
 * ultimately reference this map.
 */
const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: [
    'users:manage',
    'events:create', 'events:edit', 'events:delete', 'events:view',
    'tokens:create', 'tokens:revoke', 'tokens:view',
    'settings:manage',
    'viewers:manage',
    'dashboard:view',
    'audit:view',
  ],
  ADMIN: [
    'events:create', 'events:edit', 'events:delete', 'events:view',
    'tokens:create', 'tokens:revoke', 'tokens:view',
    'settings:manage',
    'viewers:manage',
    'dashboard:view',
  ],
  OPERATOR: [
    'events:view',
    'tokens:view',
    'viewers:manage',
    'dashboard:view',
  ],
  VIEWER_MANAGER: [
    'events:view',
    'tokens:create', 'tokens:revoke', 'tokens:view',
    'dashboard:view',
  ],
  READ_ONLY: [
    'events:view',
    'tokens:view',
    'dashboard:view',
  ],
};

/**
 * Check if a given role has a specific permission.
 * Returns false for unknown roles (safety default: deny).
 *
 * Example: hasPermission('ADMIN', 'events:create') → true
 * Example: hasPermission('READ_ONLY', 'events:create') → false
 */
export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Get all permissions granted to a role.
 * Used by the session endpoint to tell the frontend which UI elements to show.
 */
export function getPermissions(role: AdminRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
