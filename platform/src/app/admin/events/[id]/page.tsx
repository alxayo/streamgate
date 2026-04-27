'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Download, Edit, Power, Archive, Trash2, Ban, Copy, Check, Play, Users, QrCode, Eraser, Film, Loader2, Radio, Settings, ClipboardCopy } from 'lucide-react';
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
import { TokenQrDialog } from '@/components/admin/token-qr-dialog';

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
  autoPurge: boolean;
  activeViewers: number;
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
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [togglingAutoPurge, setTogglingAutoPurge] = useState(false);

  // Stream config + ingest endpoints (fetched for LIVE events)
  const [streamConfig, setStreamConfig] = useState<{
    configSource: string;
    transcoder: Record<string, unknown>;
    player: Record<string, unknown>;
    overrides: { transcoder: boolean; player: boolean };
    ingest: {
      rtmp: { url: string; server: string; streamKey: string };
      srt: { url: string } | null;
      key: string;
      token: string | null;
    };
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

      // Fetch stream config + ingest endpoints for LIVE events
      if (eventData.data?.streamType === 'LIVE') {
        try {
          const configRes = await fetch(`/api/admin/events/${eventId}/stream-config`);
          if (configRes.ok) {
            const configData = await configRes.json();
            setStreamConfig(configData.data);
          }
        } catch { /* stream config is non-critical */ }
      }
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

  const handlePurge = async () => {
    setPurging(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/purge`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(`Purge complete. Deleted ${data.data.deletedBlobs} blob(s).`);
      } else {
        alert(`Purge failed: ${data.error}`);
      }
    } catch {
      alert('Purge failed: network error');
    } finally {
      setPurging(false);
    }
  };

  const handleFinalize = async () => {
    if (!confirm('Convert this event to VOD? This will rebuild all playlists with #EXT-X-ENDLIST.')) return;
    setFinalizing(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/finalize`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(`Finalized as VOD. ${data.data.variants?.length || 0} variant(s) processed.`);
        fetchEvent();
      } else {
        alert(`Finalize failed: ${data.error}`);
      }
    } catch {
      alert('Finalize failed: network error');
    } finally {
      setFinalizing(false);
    }
  };

  const handleToggleAutoPurge = async () => {
    if (!event) return;
    setTogglingAutoPurge(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoPurge: !event.autoPurge }),
      });
      if (res.ok) {
        fetchEvent();
      }
    } catch {
      console.error('Failed to toggle auto-purge');
    } finally {
      setTogglingAutoPurge(false);
    }
  };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  /** Copy a value to clipboard and show a brief "Copied!" indicator */
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
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
            {event.streamType === 'LIVE' && (
              <button
                onClick={handleToggleAutoPurge}
                disabled={togglingAutoPurge}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer transition-colors hover:opacity-80 ${
                  event.autoPurge
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
                title="Click to toggle auto-purge"
              >
                {togglingAutoPurge ? '...' : event.autoPurge ? 'Auto-purge ON' : 'Auto-purge OFF'}
              </button>
            )}
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
      <div className="grid grid-cols-5 gap-4">
        <Link
          href={`/admin/events/${eventId}/viewers`}
          className="bg-white rounded-lg border border-gray-200 p-4 hover:border-green-300 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-green-600" />
            <p className="text-2xl font-semibold text-gray-900">{event.activeViewers}</p>
          </div>
          <p className="text-xs text-green-600 font-medium">Active Viewers</p>
        </Link>
        {Object.entries(event.tokenBreakdown).map(([status, count]) => (
          <div key={status} className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-2xl font-semibold text-gray-900">{count}</p>
            <p className="text-xs text-gray-500 capitalize">{status}</p>
          </div>
        ))}
      </div>

      {/* ================================================================
          INGEST ENDPOINTS — RTMP/SRT URLs for OBS/FFmpeg
          Only shown for LIVE events when stream config is loaded.
          ================================================================ */}
      {event.streamType === 'LIVE' && streamConfig && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-red-500" />
            <h3 className="font-medium text-gray-900">Ingest Endpoints</h3>
          </div>

          {/* Stream Key & Token — prominent display */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="space-y-1">
              <p className="text-xs font-medium text-blue-700 uppercase tracking-wider">Stream Key</p>
              <div className="flex items-center gap-1">
                <code className="flex-1 bg-white border border-blue-200 rounded px-3 py-1.5 text-sm font-mono text-gray-900 select-all">
                  {streamConfig.ingest.key}
                </code>
                <button
                  onClick={() => copyToClipboard(streamConfig.ingest.key, 'ingest-key')}
                  className="p-1.5 text-blue-500 hover:text-blue-700 transition-colors shrink-0"
                >
                  {copiedField === 'ingest-key' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            {streamConfig.ingest.token && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-blue-700 uppercase tracking-wider">Stream Token</p>
                <div className="flex items-center gap-1">
                  <code className="flex-1 bg-white border border-blue-200 rounded px-3 py-1.5 text-sm font-mono text-gray-900 select-all">
                    {streamConfig.ingest.token}
                  </code>
                  <button
                    onClick={() => copyToClipboard(streamConfig.ingest.token!, 'ingest-token')}
                    className="p-1.5 text-blue-500 hover:text-blue-700 transition-colors shrink-0"
                  >
                    {copiedField === 'ingest-token' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RTMP — full URL */}
          <div className="space-y-1">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">RTMP (full URL)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm font-mono text-gray-800 break-all select-all">
                {streamConfig.ingest.rtmp.url}
              </code>
              <button
                onClick={() => copyToClipboard(streamConfig.ingest.rtmp.url, 'rtmp-url')}
                className="p-2 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                title="Copy RTMP URL"
              >
                {copiedField === 'rtmp-url' ? <Check className="h-4 w-4 text-green-500" /> : <ClipboardCopy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* RTMP — split for OBS (Server + Stream Key) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">OBS Server</p>
              <div className="flex items-center gap-1">
                <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-mono text-gray-800 break-all select-all">
                  {streamConfig.ingest.rtmp.server}
                </code>
                <button
                  onClick={() => copyToClipboard(streamConfig.ingest.rtmp.server, 'rtmp-server')}
                  className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                >
                  {copiedField === 'rtmp-server' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">OBS Stream Key</p>
              <div className="flex items-center gap-1">
                <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-mono text-gray-800 break-all select-all">
                  {streamConfig.ingest.rtmp.streamKey}
                </code>
                <button
                  onClick={() => copyToClipboard(streamConfig.ingest.rtmp.streamKey, 'rtmp-key')}
                  className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                >
                  {copiedField === 'rtmp-key' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* SRT — if configured */}
          {streamConfig.ingest.srt && (
            <div className="space-y-1 pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">SRT</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm font-mono text-gray-800 break-all select-all">
                  {streamConfig.ingest.srt.url}
                </code>
                <button
                  onClick={() => copyToClipboard(streamConfig.ingest.srt!.url, 'srt-url')}
                  className="p-2 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
                >
                  {copiedField === 'srt-url' ? <Check className="h-4 w-4 text-green-500" /> : <ClipboardCopy className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {!streamConfig.ingest.srt && (
            <p className="text-xs text-gray-400 pt-1">SRT not configured. Set SRT_SERVER_HOST env var to enable.</p>
          )}
        </div>
      )}

      {/* ================================================================
          STREAM CONFIGURATION — effective config with Default/Custom badges
          Only shown for LIVE events when stream config is loaded.
          ================================================================ */}
      {event.streamType === 'LIVE' && streamConfig && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-gray-500" />
              <h3 className="font-medium text-gray-900">Stream Configuration</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                streamConfig.configSource === 'event'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {streamConfig.configSource === 'event' ? 'Custom' : 'System Default'}
              </span>
              <Link href={`/admin/events/${eventId}/edit`}>
                <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50 text-xs h-7 px-2">
                  Edit
                </Button>
              </Link>
            </div>
          </div>

          {/* Transcoder settings grid */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Profile</p>
              <p className="font-medium text-gray-900">{String(streamConfig.transcoder.profile)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Segment Duration</p>
              <p className="font-medium text-gray-900">{String(streamConfig.transcoder.hlsTime)}s</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Playlist Window</p>
              <p className="font-medium text-gray-900">{String(streamConfig.transcoder.hlsListSize)} segments</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Keyframe Interval</p>
              <p className="font-medium text-gray-900">{String(streamConfig.transcoder.forceKeyFrameInterval)}s</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">H.264 Tune</p>
              <p className="font-medium text-gray-900">{String((streamConfig.transcoder.h264 as Record<string, unknown>)?.tune || 'none')}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">H.264 Preset</p>
              <p className="font-medium text-gray-900">{String((streamConfig.transcoder.h264 as Record<string, unknown>)?.preset || 'ultrafast')}</p>
            </div>
          </div>

          {/* Player settings */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Player</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Live Sync</p>
                <p className="font-medium text-gray-900">{String(streamConfig.player.liveSyncDurationCount)} segments</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Max Latency</p>
                <p className="font-medium text-gray-900">{String(streamConfig.player.liveMaxLatencyDurationCount)} segments</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Low Latency Mode</p>
                <p className="font-medium text-gray-900">{streamConfig.player.lowLatencyMode ? 'Enabled' : 'Disabled'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

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
        <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50"
            onClick={handlePurge} disabled={purging}>
          {purging ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Eraser className="h-3.5 w-3.5 mr-1" />}
          Purge Stream
        </Button>
        {event.streamType === 'LIVE' && (
          <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50"
            onClick={handleFinalize} disabled={finalizing}>
            {finalizing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Film className="h-3.5 w-3.5 mr-1" />}
            Finalize as VOD
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
                    <button onClick={() => setQrCode(token.code)} className="text-gray-400 hover:text-gray-600" title="Show QR code">
                      <QrCode className="h-3.5 w-3.5" />
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

      {/* QR Code Dialog */}
      <TokenQrDialog code={qrCode} open={qrCode !== null} onOpenChange={(open) => { if (!open) setQrCode(null); }} />
    </div>
  );
}
