'use client';

// =========================================================================
// Admin User List Page (/admin/users)
// =========================================================================
// Displays a table of all admin users with their role, 2FA status, active
// status, and last login. Available actions:
//   - Edit: navigate to user detail/edit page
//   - Reset 2FA: force the user to set up 2FA again on next login
//   - Deactivate/Reactivate: soft-disable a user's account
//   - Add User: navigate to user creation form
//
// Requires 'users:manage' permission (Super Admin role only).
// =========================================================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Shield, ShieldOff, Loader2, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/** Shape of admin user data returned by the API */
interface AdminUser {
  id: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Human-readable labels for role values */
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  VIEWER_MANAGER: 'Viewer Manager',
  READ_ONLY: 'Read Only',
};

/** Badge color variants per role (for visual hierarchy) */
const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  SUPER_ADMIN: 'destructive',
  ADMIN: 'default',
  OPERATOR: 'secondary',
  VIEWER_MANAGER: 'secondary',
  READ_ONLY: 'outline',
};

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchUsers();
  }, []);

  /** Fetch all admin users from the API */
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        if (res.status === 403) {
          setError('You do not have permission to manage users.');
          return;
        }
        throw new Error('Failed to fetch users');
      }
      const data = await res.json();
      setUsers(data.data);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  /** Toggle a user's active/inactive status (with confirmation for deactivation) */
  const toggleActive = async (userId: string, currentlyActive: boolean) => {
    if (currentlyActive) {
      if (!confirm('Are you sure you want to deactivate this user?')) return;
    }

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentlyActive }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to update user');
        return;
      }

      fetchUsers();
    } catch {
      alert('Network error');
    }
  };

  /** Reset a user's 2FA setup (they'll need to re-enroll on next login) */
  const reset2FA = async (userId: string) => {
    if (!confirm('This will require the user to set up 2FA again on their next login. Continue?')) return;

    try {
      const res = await fetch('/api/admin/2fa/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to reset 2FA');
        return;
      }

      fetchUsers();
    } catch {
      alert('Network error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">{users.length} admin user(s)</p>
        </div>
        <Button onClick={() => router.push('/admin/users/new')}>
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Role</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">2FA</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Last Login</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className={!user.isActive ? 'opacity-50' : ''}>
                <td className="px-4 py-3 text-sm text-gray-900">{user.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={ROLE_VARIANTS[user.role] || 'secondary'}>
                    {ROLE_LABELS[user.role] || user.role}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {user.totpEnabled ? (
                    <Shield className="h-4 w-4 text-green-500" />
                  ) : (
                    <ShieldOff className="h-4 w-4 text-gray-300" />
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={user.isActive ? 'default' : 'outline'}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleDateString()
                    : 'Never'}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/admin/users/${user.id}/edit`)}
                  >
                    <UserCog className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                  {user.totpEnabled && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reset2FA(user.id)}
                    >
                      Reset 2FA
                    </Button>
                  )}
                  <Button
                    variant={user.isActive ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => toggleActive(user.id, user.isActive)}
                  >
                    {user.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
