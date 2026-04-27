'use client';

// =========================================================================
// Creator Event Detail — /creator/events/:id
// =========================================================================
// Full management view for a single event:
//   - View & edit event metadata (title, dates, stream URL)
//   - View RTMP/SRT ingest credentials (stream key + token)
//   - Generate access tokens (batch)
//   - Perform actions: convert to VOD, purge HLS cache, deactivate
//
// All operations are scoped to the creator's channel — the API rejects
// attempts to access events owned by other channels.
// =========================================================================

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Check, Pencil, Trash2, Archive, Eraser, Save, X } from 'lucide-react';

interface EventData {
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
}

interface TokenData {
  id: string;
  code: string;
  label: string | null;
  isRevoked: boolean;
  redeemedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

interface IngestData {
  rtmp: { url: string; server: string; streamKey: string };
  srt: { url: string } | null;
  key: string;
  token: string | null;
}

export default function CreatorEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [event, setEvent] = useState<EventData | null>(null);
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [ingest, setIngest] = useState<IngestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generateCount, setGenerateCount] = useState(10);
  const [generateLabel, setGenerateLabel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', description: '', startsAt: '', endsAt: '', accessWindowHours: 24 });
  const [saving, setSaving] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVod, setConfirmVod] = useState(false);

  const fetchEvent = () => {
    fetch(`/api/creator/events/${id}`)
      .then(res => res.json())
      .then(data => {
        setEvent(data.data);
        if (data.data) {
          setEditForm({
            title: data.data.title,
            description: data.data.description || '',
            startsAt: data.data.startsAt?.slice(0, 16) || '',
            endsAt: data.data.endsAt?.slice(0, 16) || '',
            accessWindowHours: data.data.accessWindowHours,
          });
        }
      })
      .catch(() => {});
  };

  const fetchTokens = () => {
    fetch(`/api/creator/events/${id}/tokens`)
      .then(res => res.json())
      .then(data => setTokens(data.data || []))
      .catch(() => {});
  };

  const fetchIngest = () => {
    fetch(`/api/creator/events/${id}/stream-config`)
      .then(res => res.json())
      .then(data => setIngest(data.data?.ingest || null))
      .catch(() => {});
  };

  useEffect(() => {
    Promise.all([fetchEvent(), fetchTokens(), fetchIngest()])
      .finally(() => setLoading(false));
  }, [id]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/creator/events/${id}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: generateCount, label: generateLabel || undefined }),
      });
      if (res.ok) {
        fetchTokens();
        fetchEvent();
        setGenerateLabel('');
      }
    } catch { /* ignore */ }
    setGenerating(false);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // --- Edit handlers ---
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/creator/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description || null,
          startsAt: editForm.startsAt ? new Date(editForm.startsAt).toISOString() : undefined,
          endsAt: editForm.endsAt ? new Date(editForm.endsAt).toISOString() : undefined,
          accessWindowHours: editForm.accessWindowHours,
        }),
      });
      if (res.ok) {
        setEditing(false);
        fetchEvent();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  // --- Delete handler ---
  const handleDelete = async () => {
    setActionLoading('delete');
    try {
      const res = await fetch(`/api/creator/events/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/creator/events');
      }
    } catch { /* ignore */ }
    setActionLoading(null);
    setConfirmDelete(false);
  };

  // --- Purge handler ---
  const handlePurge = async () => {
    setActionLoading('purge');
    try {
      await fetch(`/api/creator/events/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge' }),
      });
    } catch { /* ignore */ }
    setActionLoading(null);
  };

  // --- Convert to VOD handler ---
  const handleConvertVod = async () => {
    setActionLoading('vod');
    try {
      const res = await fetch(`/api/creator/events/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert-vod' }),
      });
      if (res.ok) {
        fetchEvent();
      }
    } catch { /* ignore */ }
    setActionLoading(null);
    setConfirmVod(false);
  };

  if (loading) {
    return <div className="animate-pulse text-gray-500">Loading...</div>;
  }

  if (!event) {
    return <div className="text-red-600">Event not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/creator/events" className="p-1 rounded-md hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
          <span className={`text-xs px-2 py-1 rounded-full ${
            event.isArchived ? 'bg-purple-50 text-purple-700' :
            event.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {event.isArchived ? 'VOD' : event.isActive ? 'Active' : 'Inactive'}
          </span>
          <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700">
            {event.streamType}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Edit form (shown when editing) */}
      {editing && (
        <div className="bg-white rounded-lg border border-blue-200 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Edit Event</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={editForm.title}
                onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={editForm.description}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Starts At</label>
              <input
                type="datetime-local"
                value={editForm.startsAt}
                onChange={e => setEditForm({ ...editForm, startsAt: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ends At</label>
              <input
                type="datetime-local"
                value={editForm.endsAt}
                onChange={e => setEditForm({ ...editForm, endsAt: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Access Window (hours after end)</label>
              <input
                type="number"
                value={editForm.accessWindowHours}
                onChange={e => setEditForm({ ...editForm, accessWindowHours: parseInt(e.target.value) || 24 })}
                min={1}
                className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Event details (read-only) */}
      {!editing && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Type</p>
              <p className="font-medium text-gray-900">{event.streamType}</p>
            </div>
            <div>
              <p className="text-gray-500">Starts</p>
              <p className="font-medium text-gray-900">{new Date(event.startsAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-500">Ends</p>
              <p className="font-medium text-gray-900">{new Date(event.endsAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-500">Tokens</p>
              <p className="font-medium text-gray-900">{event._count.tokens}</p>
            </div>
          </div>
          {event.description && (
            <p className="text-sm text-gray-600">{event.description}</p>
          )}
        </div>
      )}

      {/* Ingest Endpoints */}
      {ingest && event.streamType === 'LIVE' && !event.isArchived && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Streaming Endpoints</h2>
          <p className="text-sm text-gray-500">Use these URLs in OBS, FFmpeg, or any RTMP/SRT encoder to stream to this event.</p>

          {/* Stream Key & Token — prominent display */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div>
              <label className="text-xs font-medium text-blue-700 uppercase tracking-wider">Stream Key</label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-sm font-mono bg-white border border-blue-200 rounded px-3 py-2 text-gray-900 select-all">
                  {ingest.key}
                </code>
                <button
                  onClick={() => copyToClipboard(ingest.key, 'stream-key')}
                  className="p-1.5 text-blue-500 hover:text-blue-700 shrink-0"
                  title="Copy stream key"
                >
                  {copiedField === 'stream-key' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {ingest.token && (
              <div>
                <label className="text-xs font-medium text-blue-700 uppercase tracking-wider">Stream Token</label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 text-sm font-mono bg-white border border-blue-200 rounded px-3 py-2 text-gray-900 select-all">
                    {ingest.token}
                  </code>
                  <button
                    onClick={() => copyToClipboard(ingest.token!, 'stream-token')}
                    className="p-1.5 text-blue-500 hover:text-blue-700 shrink-0"
                    title="Copy stream token"
                  >
                    {copiedField === 'stream-token' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RTMP */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700">RTMP</h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500">Full URL (for FFmpeg)</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-800 break-all">
                    {ingest.rtmp.url}
                  </code>
                  <button
                    onClick={() => copyToClipboard(ingest.rtmp.url, 'rtmp-url')}
                    className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                    title="Copy"
                  >
                    {copiedField === 'rtmp-url' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Server (for OBS)</label>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-800">
                      {ingest.rtmp.server}
                    </code>
                    <button
                      onClick={() => copyToClipboard(ingest.rtmp.server, 'rtmp-server')}
                      className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                      title="Copy"
                    >
                      {copiedField === 'rtmp-server' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Stream Key (for OBS)</label>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-800 break-all">
                      {ingest.rtmp.streamKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(ingest.rtmp.streamKey, 'rtmp-key')}
                      className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                      title="Copy"
                    >
                      {copiedField === 'rtmp-key' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SRT */}
          {ingest.srt && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-700">SRT</h3>
              <div>
                <label className="text-xs text-gray-500">Full URL</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-800 break-all">
                    {ingest.srt.url}
                  </code>
                  <button
                    onClick={() => copyToClipboard(ingest.srt!.url, 'srt-url')}
                    className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                    title="Copy"
                  >
                    {copiedField === 'srt-url' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stream Actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Actions</h2>
        <div className="flex flex-wrap gap-3">
          {/* Purge cache */}
          <button
            onClick={handlePurge}
            disabled={actionLoading === 'purge'}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 disabled:opacity-50 transition-colors"
          >
            <Eraser className="h-3.5 w-3.5" />
            {actionLoading === 'purge' ? 'Purging...' : 'Purge Cache'}
          </button>

          {/* Convert to VOD — only for LIVE streams */}
          {event.streamType === 'LIVE' && !event.isArchived && (
            <>
              {!confirmVod ? (
                <button
                  onClick={() => setConfirmVod(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
                >
                  <Archive className="h-3.5 w-3.5" /> Convert to VOD
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">End live stream and archive as VOD?</span>
                  <button
                    onClick={handleConvertVod}
                    disabled={actionLoading === 'vod'}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-700 disabled:opacity-50"
                  >
                    {actionLoading === 'vod' ? 'Converting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmVod(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          {/* Delete event */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Are you sure? This deactivates the event.</span>
              <button
                onClick={handleDelete}
                disabled={actionLoading === 'delete'}
                className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading === 'delete' ? 'Deleting...' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Token generation */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Generate Tokens</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="count" className="block text-sm font-medium text-gray-700 mb-1">Count</label>
            <input
              id="count"
              type="number"
              min={1}
              max={100}
              value={generateCount}
              onChange={e => setGenerateCount(parseInt(e.target.value) || 1)}
              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <div>
            <label htmlFor="label" className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
            <input
              id="label"
              type="text"
              value={generateLabel}
              onChange={e => setGenerateLabel(e.target.value)}
              placeholder="e.g., VIP batch"
              className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating...' : `Generate ${generateCount} Tokens`}
          </button>
        </div>
      </div>

      {/* Token list */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Tokens ({tokens.length})</h2>
        </div>
        {tokens.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500">
            No tokens generated yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-96 overflow-auto">
            {tokens.map(token => (
              <div key={token.id} className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-3">
                  <code className="text-sm font-mono bg-gray-50 px-2 py-1 rounded text-gray-900">
                    {token.code}
                  </code>
                  <button
                    onClick={() => copyToClipboard(token.code, `token-${token.id}`)}
                    className="p-1 text-gray-400 hover:text-gray-600"
                    title="Copy code"
                  >
                    {copiedField === `token-${token.id}` ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  {token.label && (
                    <span className="text-xs text-gray-500">{token.label}</span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  token.isRevoked
                    ? 'bg-red-50 text-red-700'
                    : token.redeemedAt
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                }`}>
                  {token.isRevoked ? 'Revoked' : token.redeemedAt ? 'Redeemed' : 'Unused'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
