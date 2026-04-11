'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Download, Edit, Power, Archive, Trash2, Ban, Copy, Check, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EventStatusBadge } from '@/components/admin/event-status-badge';
import { TokenStatusBadge } from '@/components/admin/token-status-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface EventDetail {
  id: string;
  title: string;
  description: string | null;
  streamType: string;
  streamUrl: string | null;
  startsAt: string;
  endsAt: string;
  accessWindowHours: number;
  isActive: boolean;
  isArchived: boolean;
  _count: { tokens: number };
  tokenBreakdown: { unused: number; redeemed: number; expired: number; revoked: number };
}

interface Token {
  id: string;
  code: string;
  label: string | null;
  isRevoked: boolean;
  redeemedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [generateCount, setGenerateCount] = useState(10);
  const [generateLabel, setGenerateLabel] = useState('');
  const [generatedTokens, setGeneratedTokens] = useState<Token[]>([]);
  const [deleteConfirmTitle, setDeleteConfirmTitle] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchEvent = async () => {
    try {
      const [eventRes, tokensRes] = await Promise.all([
        fetch(`/api/admin/events/${eventId}`),
        fetch(`/api/admin/events/${eventId}/tokens?limit=50`),
      ]);
      const eventData = await eventRes.json();
      const tokensData = await tokensRes.json();
      setEvent(eventData.data);
      setTokens(tokensData.data || []);
    } catch {
      console.error('Failed to fetch event details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEvent(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerateTokens = async () => {
    try {
      const res = await fetch(`/api/admin/events/${eventId}/tokens/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: generateCount, label: generateLabel || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setGeneratedTokens(data.data);
        fetchEvent();
      }
    } catch {
      console.error('Failed to generate tokens');
    }
  };

  const handleDeleteEvent = async () => {
    if (!event || deleteConfirmTitle !== event.title) return;
    try {
      await fetch(`/api/admin/events/${eventId}`, {
        method: 'DELETE',
        headers: { 'X-Confirm-Delete': event.title },
      });
      router.push('/admin/events');
    } catch {
      console.error('Failed to delete event');
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    await fetch(`/api/admin/tokens/${tokenId}/revoke`, { method: 'PATCH' });
    fetchEvent();
  };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) return <div className="text-gray-400">Loading...</div>;
  if (!event) return <div className="text-gray-400">Event not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{event.title}</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-gray-500">
              {new Date(event.startsAt).toLocaleString()} — {new Date(event.endsAt).toLocaleString()}
            </p>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              event.streamType === 'VOD'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-red-100 text-red-700'
            }`}>
              {event.streamType === 'VOD' ? 'VOD' : 'Live'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1 font-mono">{event.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <EventStatusBadge isActive={event.isActive} isArchived={event.isArchived} />
          <Link href={`/admin/events/${eventId}/edit`}>
            <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
              <Edit className="h-3.5 w-3.5 mr-1" /> Edit
            </Button>
          </Link>
          <Link href={`/admin/events/${eventId}/preview`}>
            <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
              <Play className="h-3.5 w-3.5 mr-1" /> Preview
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {Object.entries(event.tokenBreakdown).map(([status, count]) => (
          <div key={status} className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-2xl font-semibold text-gray-900">{count}</p>
            <p className="text-xs text-gray-500 capitalize">{status}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { setShowGenerateDialog(true); setGeneratedTokens([]); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Generate Tokens
        </Button>
        <a href={`/api/admin/events/${eventId}/tokens/export`} download>
          <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
            <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
          </Button>
        </a>
        {event.isActive ? (
          <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50"
            onClick={async () => { await fetch(`/api/admin/events/${eventId}/deactivate`, { method: 'PATCH' }); fetchEvent(); }}>
            <Power className="h-3.5 w-3.5 mr-1" /> Deactivate
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50"
            onClick={async () => { await fetch(`/api/admin/events/${eventId}/reactivate`, { method: 'PATCH' }); fetchEvent(); }}>
            <Power className="h-3.5 w-3.5 mr-1" /> Reactivate
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
        </Button>
      </div>

      {/* Token List */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Label</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Redeemed</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Expires</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm tracking-wider text-gray-900">{token.code}</code>
                    <button onClick={() => copyCode(token.code, token.id)} className="text-gray-400 hover:text-gray-600">
                      {copiedId === token.id ? <Check className="h-3.5 w-3.5 text-status-active" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{token.label || '—'}</td>
                <td className="px-4 py-3">
                  <TokenStatusBadge isRevoked={token.isRevoked} redeemedAt={token.redeemedAt} expiresAt={token.expiresAt} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {token.redeemedAt ? new Date(token.redeemedAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {new Date(token.expiresAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {!token.isRevoked && (
                    <button onClick={() => handleRevokeToken(token.id)} className="text-red-500 hover:text-red-700 text-sm">
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generate Tokens Dialog */}
      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent className="bg-white border-gray-200 text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Generate Tokens</DialogTitle>
            <DialogDescription className="text-gray-500">
              Generate access tokens for {event.title}
            </DialogDescription>
          </DialogHeader>
          {generatedTokens.length === 0 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Count (1-500)</label>
                <Input type="number" value={generateCount} onChange={(e) => setGenerateCount(parseInt(e.target.value) || 1)}
                  min={1} max={500} className="bg-white border-gray-300 text-gray-900" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Label (optional)</label>
                <Input value={generateLabel} onChange={(e) => setGenerateLabel(e.target.value)}
                  placeholder="e.g., VIP Batch" className="bg-white border-gray-300 text-gray-900" />
              </div>
              <DialogFooter>
                <Button onClick={handleGenerateTokens}>Generate {generateCount} Tokens</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-status-active font-medium">
                ✓ Generated {generatedTokens.length} tokens
              </p>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {generatedTokens.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-1">
                    <code className="font-mono text-sm tracking-wider">{t.code}</code>
                    <button onClick={() => copyCode(t.code, t.id)} className="text-gray-400 hover:text-gray-600">
                      {copiedId === t.id ? <Check className="h-3.5 w-3.5 text-status-active" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50" onClick={() => setShowGenerateDialog(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Event Dialog (two-step) */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-white border-gray-200 text-gray-900">
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Event</DialogTitle>
            <DialogDescription className="text-gray-500">
              This will permanently delete &ldquo;{event.title}&rdquo; and all {event._count.tokens} associated tokens.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-gray-700">Type the event title to confirm:</label>
            <Input value={deleteConfirmTitle} onChange={(e) => setDeleteConfirmTitle(e.target.value)}
              placeholder={event.title} className="bg-white border-gray-300 text-gray-900" />
          </div>
          <DialogFooter>
            <Button variant="outline" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteConfirmTitle !== event.title} onClick={handleDeleteEvent}>
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
