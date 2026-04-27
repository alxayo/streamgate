'use client';

// =========================================================================
// Create New Admin User Page (/admin/users/new)
// =========================================================================
// Form for Super Admins to create new admin users.
//   - Email: required, must be unique
//   - Password: optional (auto-generates a secure 16-char password if blank)
//   - Role: dropdown with all 5 roles and descriptions
//
// After creation, displays the temporary password (if auto-generated) in
// a prominent amber box. The password is shown ONCE and never again.
// New users will be forced to set up 2FA on their first login.
// =========================================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

/** Available roles with human-readable descriptions for the dropdown */
const ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super Admin', description: 'Full access + user management' },
  { value: 'ADMIN', label: 'Admin', description: 'Full access (no user management)' },
  { value: 'OPERATOR', label: 'Operator', description: 'View events/tokens, manage viewers' },
  { value: 'VIEWER_MANAGER', label: 'Viewer Manager', description: 'Manage tokens only' },
  { value: 'READ_ONLY', label: 'Read Only', description: 'View-only access' },
];

export default function NewUserPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('ADMIN');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdUser, setCreatedUser] = useState<{
    email: string;
    temporaryPassword?: string;
  } | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError('');

    try {
      const body: Record<string, string> = { email, role };
      if (password) body.password = password;

      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create user');
        return;
      }

      setCreatedUser({
        email: data.data.email,
        temporaryPassword: data.data.temporaryPassword,
      });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (createdUser) {
    return (
      <div className="p-6 flex justify-center">
        <Card className="w-full max-w-md bg-white border-gray-200 text-gray-900">
          <CardHeader>
            <CardTitle>User Created</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600">
              <strong>{createdUser.email}</strong> has been created.
              They will need to set up two-factor authentication on first login.
            </p>
            {createdUser.temporaryPassword && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800">Temporary Password</p>
                <p className="font-mono text-sm mt-1 text-amber-900 select-all">
                  {createdUser.temporaryPassword}
                </p>
                <p className="text-xs text-amber-600 mt-2">
                  Share this password securely. It will not be shown again.
                </p>
              </div>
            )}
            <Button onClick={() => router.push('/admin/users')} className="w-full">
              Back to Users
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 flex justify-center">
      <Card className="w-full max-w-md bg-white border-gray-200 text-gray-900">
        <CardHeader>
          <CardTitle>Create Admin User</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                Password <span className="text-gray-400 text-xs">(leave blank to auto-generate)</span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Min 12 characters (or auto-generated)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="bg-gray-50 border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <span>{r.label}</span>
                      <span className="text-xs text-gray-400 ml-2">{r.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/admin/users')}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={loading || !email}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create User'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
