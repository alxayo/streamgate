'use client';

// =========================================================================
// Audit Log Viewer Page (/admin/audit-log)
// =========================================================================
// Displays a paginated, filterable table of all admin authentication and
// management events. Each row shows timestamp, acting user, action type,
// client IP, and optional JSON details.
//
// Features:
//   - Filter by action type (dropdown)
//   - Color-coded action badges (green=success, red=failure, amber=warning)
//   - Pagination with 50 entries per page
//
// Requires 'audit:view' permission (Super Admin role only).
// =========================================================================

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Shape of a single audit log entry from the API */
interface AuditEntry {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  details: Record<string, unknown> | null;
  ipAddress: string;
  createdAt: string;
}

/** Dropdown options for filtering the audit log by action type */
const ACTION_OPTIONS = [
  { value: 'all', label: 'All actions' },
  { value: 'login', label: 'Login' },
  { value: 'login_failed', label: 'Login failed' },
  { value: '2fa_setup', label: '2FA setup' },
  { value: '2fa_failed', label: '2FA failed' },
  { value: '2fa_reset', label: '2FA reset' },
  { value: 'recovery_code_used', label: 'Recovery code used' },
  { value: 'emergency_login', label: 'Emergency login' },
  { value: 'emergency_login_failed', label: 'Emergency login failed' },
  { value: 'user_created', label: 'User created' },
  { value: 'user_updated', label: 'User updated' },
  { value: 'user_deactivated', label: 'User deactivated' },
  { value: 'admin_seeded', label: 'Admin seeded' },
];

/** CSS classes for color-coding action badges by severity */
const ACTION_COLORS: Record<string, string> = {
  login: 'text-green-700 bg-green-50',
  login_failed: 'text-red-700 bg-red-50',
  '2fa_failed': 'text-red-700 bg-red-50',
  emergency_login: 'text-amber-700 bg-amber-50',
  emergency_login_failed: 'text-red-700 bg-red-50',
  recovery_code_used: 'text-amber-700 bg-amber-50',
  user_created: 'text-blue-700 bg-blue-50',
  user_deactivated: 'text-gray-700 bg-gray-100',
};

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (actionFilter && actionFilter !== 'all') params.set('action', actionFilter);

      const res = await fetch(`/api/admin/audit-log?${params}`);
      if (!res.ok) {
        if (res.status === 403) {
          setError('You do not have permission to view the audit log.');
          return;
        }
        throw new Error('Failed to fetch');
      }
      const data = await res.json();
      setEntries(data.data);
      setTotalPages(data.pagination.totalPages);
    } catch {
      setError('Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <Select
          value={actionFilter}
          onValueChange={(val) => { setActionFilter(val); setPage(1); }}
        >
          <SelectTrigger className="w-[200px] bg-white border-gray-300 text-gray-900">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p className="text-red-500">{error}</p>
      ) : loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">IP</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {entry.userEmail || (entry.userId ? entry.userId : 'System')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${ACTION_COLORS[entry.action] || 'text-gray-700 bg-gray-50'}`}>
                        {entry.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono">{entry.ipAddress}</td>
                    <td className="px-4 py-3 text-xs text-gray-400 max-w-xs truncate">
                      {entry.details ? JSON.stringify(entry.details) : '—'}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                      No audit log entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-gray-500">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
