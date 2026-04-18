'use client';

import { useState, useEffect } from 'react';
import { Ban, Copy, Check, Search, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TokenStatusBadge } from '@/components/admin/token-status-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TokenQrDialog } from '@/components/admin/token-qr-dialog';

interface Token {
  id: string;
  code: string;
  label: string | null;
  isRevoked: boolean;
  redeemedAt: string | null;
  expiresAt: string;
  createdAt: string;
  event?: { title: string };
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qrCode, setQrCode] = useState<string | null>(null);

  const fetchTokens = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '50' });
    if (status !== 'all') params.set('status', status);
    if (search) params.set('search', search);

    try {
      const res = await fetch(`/api/admin/tokens?${params}`);
      const data = await res.json();
      setTokens(data.data || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch {
      console.error('Failed to fetch tokens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTokens(); }, [status, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchTokens();
  };

  const handleBulkRevoke = async () => {
    if (selectedIds.size === 0) return;
    await fetch('/api/admin/tokens/bulk-revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenIds: Array.from(selectedIds) }),
    });
    setSelectedIds(new Set());
    fetchTokens();
  };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">Tokens</h1>

      <div className="flex items-center gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[130px] bg-white border-gray-300 text-gray-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-200 text-gray-900">
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unused">Unused</SelectItem>
            <SelectItem value="redeemed">Redeemed</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or label..."
              className="pl-9 bg-white border-gray-300 text-gray-900 w-64"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
            Search
          </Button>
        </form>

        {selectedIds.size > 0 && (
          <Button variant="destructive" size="sm" onClick={handleBulkRevoke}>
            <Ban className="h-3.5 w-3.5 mr-1" /> Revoke {selectedIds.size} Selected
          </Button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading tokens...</div>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(tokens.filter((t) => !t.isRevoked).map((t) => t.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Event</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Label</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Expires</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(token.id)}
                        onChange={() => toggleSelect(token.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-sm tracking-wider text-gray-900">{token.code}</code>
                        <button onClick={() => copyCode(token.code, token.id)} className="text-gray-400 hover:text-gray-600">
                          {copiedId === token.id ? <Check className="h-3.5 w-3.5 text-status-active" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => setQrCode(token.code)} className="text-gray-400 hover:text-gray-600" title="Show QR code">
                          <QrCode className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{token.event?.title || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{token.label || '—'}</td>
                    <td className="px-4 py-3">
                      <TokenStatusBadge isRevoked={token.isRevoked} redeemedAt={token.redeemedAt} expiresAt={token.expiresAt} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(token.expiresAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!token.isRevoked && (
                        <button
                          onClick={async () => { await fetch(`/api/admin/tokens/${token.id}/revoke`, { method: 'PATCH' }); fetchTokens(); }}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
                Previous
              </Button>
              <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {/* QR Code Dialog */}
      <TokenQrDialog code={qrCode} open={qrCode !== null} onOpenChange={(open) => { if (!open) setQrCode(null); }} />
    </div>
  );
}
