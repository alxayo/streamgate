'use client';

// =========================================================================
// Edit Admin User Page (/admin/users/:id/edit)
// =========================================================================
// Allows Super Admins to view and modify an individual admin user:
//   - View: email, creation date, creator, last login, 2FA status, recovery codes
//   - Edit: role (dropdown), password (reset with new value)
//
// Safety: the API prevents self-demotion and removal of the last Super Admin.
// All changes are audit-logged.
// =========================================================================

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Available roles for the role dropdown */
const ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'OPERATOR', label: 'Operator' },
  { value: 'VIEWER_MANAGER', label: 'Viewer Manager' },
  { value: 'READ_ONLY', label: 'Read Only' },
];

/** Detailed user info returned by GET /api/admin/users/:id */
interface UserDetail {
  id: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  mustSetup2FA: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: { email: string } | null;
  remainingRecoveryCodes: number;
}

export default function EditUserPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [role, setRole] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchUser();
  }, [id]);

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/admin/users/${id}`);
      if (!res.ok) throw new Error('Failed to fetch user');
      const data = await res.json();
      setUser(data.data);
      setRole(data.data.role);
    } catch {
      setError('Failed to load user');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError('');
    setSuccess('');

    const updates: Record<string, unknown> = {};
    if (role !== user.role) updates.role = role;
    if (newPassword) updates.newPassword = newPassword;

    if (Object.keys(updates).length === 0) {
      setError('No changes to save');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to update user');
        return;
      }

      setSuccess('User updated successfully');
      setNewPassword('');
      fetchUser();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6">
        <p className="text-red-500">{error || 'User not found'}</p>
      </div>
    );
  }

  return (
    <div className="p-6 flex justify-center">
      <Card className="w-full max-w-md bg-white border-gray-200 text-gray-900">
        <CardHeader>
          <CardTitle>Edit User: {user.email}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1 text-sm text-gray-500">
              <p>Created: {new Date(user.createdAt).toLocaleDateString()}</p>
              {user.createdBy && <p>Created by: {user.createdBy.email}</p>}
              <p>Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</p>
              <p>2FA: {user.totpEnabled ? `Enabled (${user.remainingRecoveryCodes} recovery codes)` : 'Not set up'}</p>
              <p>Status: {user.isActive ? 'Active' : 'Inactive'}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="bg-gray-50 border-gray-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">
                Reset Password <span className="text-gray-400 text-xs">(leave blank to keep current)</span>
              </Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="New password (min 12 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-gray-50 border-gray-300"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
            {success && <p className="text-sm text-green-600">{success}</p>}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/admin/users')}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
