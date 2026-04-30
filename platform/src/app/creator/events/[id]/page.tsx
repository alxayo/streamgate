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

import { useState, useEffect, useRef, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Check, Pencil, Trash2, Archive, Eraser, Save, X, Upload, FileVideo, RefreshCw, RotateCcw, QrCode } from 'lucide-react';
import { IngestQrDialog, type IngestQrKind } from '@/components/ingest-qr-dialog';

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

// =========================================================================
// VOD Upload Types
// =========================================================================
// The upload flow for VOD events:
//   1. Creator selects a video file and clicks "Upload"
//   2. File is POSTed as FormData to /api/creator/events/:id/upload
//   3. Server processes the upload and begins transcoding
//   4. UI polls GET /api/creator/events/:id/upload every 3s for status
//   5. Each codec (e.g. H.264, AV1) has its own progress bar
//   6. Once all codecs finish, status becomes READY
// =========================================================================

interface TranscodeJob {
  id: string;
  codec: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number | null;
  errorMessage: string | null;
}

interface UploadData {
  id: string;
  fileName: string;
  fileSize: string; // BigInt serialized as string
  mimeType: string;
  status: 'UPLOADING' | 'UPLOADED' | 'TRANSCODING' | 'READY' | 'FAILED';
  errorMessage: string | null;
  duration: number | null;
  transcodeJobs: TranscodeJob[];
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
  const [selectedIngestQr, setSelectedIngestQr] = useState<IngestQrKind | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', description: '', startsAt: '', endsAt: '', accessWindowHours: 24 });
  const [saving, setSaving] = useState(false);

  // Action states
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVod, setConfirmVod] = useState(false);

  // --- VOD Upload state ---
  // Tracks the selected file, upload progress, and server-side upload/transcode status
  const [vodFile, setVodFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [uploadData, setUploadData] = useState<UploadData | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmReupload, setConfirmReupload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // --- VOD Upload helpers ---

  // Fetch the current upload status from the server
  const fetchUploadStatus = useCallback(() => {
    fetch(`/api/creator/events/${id}/upload`)
      .then(res => {
        if (res.status === 404) return null; // No upload exists yet
        if (!res.ok) throw new Error('Failed to fetch upload status');
        return res.json();
      })
      .then(data => {
        // data.data is { upload: UploadObj | null }
        // Only set uploadData when an actual upload record exists
        if (data?.data?.upload) setUploadData(data.data.upload);
        else setUploadData(null);
      })
      .catch(() => {});
  }, [id]);

  // Upload the selected file to the server using XMLHttpRequest for progress tracking
  const handleUpload = async () => {
    if (!vodFile) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', vodFile);

    // Use XMLHttpRequest instead of fetch so we can track upload progress
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/creator/events/${id}/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        // POST response shape differs from UploadData — fetch the real
        // upload status from the GET endpoint to populate state correctly.
        fetchUploadStatus();
        setVodFile(null);
        // Reset file input so the same file can be re-selected if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setUploadError(data.error || 'Upload failed');
        } catch {
          setUploadError('Upload failed');
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setUploadError('Network error — please check your connection and try again');
    };

    xhr.send(formData);
  };

  // Delete the current upload and reset all VOD state
  const handleDeleteUpload = async () => {
    setActionLoading('delete-upload');
    try {
      const res = await fetch(`/api/creator/events/${id}/upload`, { method: 'DELETE' });
      if (res.ok) {
        setUploadData(null);
        setVodFile(null);
        setUploadError(null);
        setUploadProgress(0);
        setConfirmReupload(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch {
      setUploadError('Failed to delete upload');
    }
    setActionLoading(null);
  };

  // Retry transcoding for a failed upload
  const handleRetryTranscode = async () => {
    setActionLoading('retry-transcode');
    setUploadError(null);
    try {
      const res = await fetch(`/api/creator/events/${id}/transcode`, { method: 'POST' });
      if (res.ok) {
        fetchUploadStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        setUploadError(data.error || 'Failed to retry transcoding');
      }
    } catch {
      setUploadError('Failed to retry transcoding');
    }
    setActionLoading(null);
  };

  // Format bytes to a human-readable string (e.g. "1.5 GB")
  const formatFileSize = (bytes: number | string): string => {
    const n = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (isNaN(n)) return 'Unknown size';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Format seconds into human-readable duration (e.g. "1h 23m 45s")
  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  useEffect(() => {
    Promise.all([fetchEvent(), fetchTokens(), fetchIngest()])
      .finally(() => setLoading(false));
  }, [id]);

  // Fetch initial VOD upload status when the event is loaded and is VOD type
  useEffect(() => {
    if (event?.streamType === 'VOD') {
      fetchUploadStatus();
    }
  }, [event?.streamType, fetchUploadStatus]);

  // Poll for upload/transcode progress every 3 seconds while processing.
  // Polling stops automatically once status reaches READY or FAILED.
  useEffect(() => {
    const shouldPoll =
      event?.streamType === 'VOD' &&
      uploadData &&
      ['UPLOADING', 'UPLOADED', 'TRANSCODING'].includes(uploadData.status);

    if (!shouldPoll) return;

    const interval = setInterval(fetchUploadStatus, 3000);
    return () => clearInterval(interval);
  }, [event?.streamType, uploadData?.status, fetchUploadStatus]);

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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Streaming Endpoints</h2>
              <p className="text-sm text-gray-500">Use these URLs in OBS, FFmpeg, or any RTMP/SRT encoder to stream to this event.</p>
            </div>
            <button
              onClick={() => setSelectedIngestQr('rtmp')}
              className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
              title="Show RTMP StreamCaster QR code"
            >
              <QrCode className="h-4 w-4" />
            </button>
          </div>

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
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-700">RTMP</h3>
              <button
                onClick={() => setSelectedIngestQr('rtmp')}
                className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                title="Show RTMP StreamCaster QR code"
              >
                <QrCode className="h-4 w-4" />
              </button>
            </div>
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
                  <button
                    onClick={() => setSelectedIngestQr('rtmp')}
                    className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                    title="Show RTMP StreamCaster QR code"
                  >
                    <QrCode className="h-4 w-4" />
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
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-gray-700">SRT</h3>
                <button
                  onClick={() => setSelectedIngestQr('srt')}
                  className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                  title="Show SRT StreamCaster QR code"
                >
                  <QrCode className="h-4 w-4" />
                </button>
              </div>
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
                  <button
                    onClick={() => setSelectedIngestQr('srt')}
                    className="p-1.5 text-gray-400 hover:text-gray-600 shrink-0"
                    title="Show SRT StreamCaster QR code"
                  >
                    <QrCode className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* VOD Upload Section                                                 */}
      {/* ================================================================= */}
      {/* Shown only for VOD events. Handles the full lifecycle:             */}
      {/*   file selection → upload → transcoding progress → ready/failed    */}
      {/* ================================================================= */}
      {event.streamType === 'VOD' && (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <FileVideo className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">VOD Upload</h2>
            {/* Status badge next to the title */}
            {uploadData && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                uploadData.status === 'READY'
                  ? 'bg-green-50 text-green-700'
                  : uploadData.status === 'FAILED'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-blue-50 text-blue-700'
              }`}>
                {uploadData.status === 'READY' ? 'VOD Ready ✓' : uploadData.status}
              </span>
            )}
          </div>

          {/* --- State 1: No upload yet — show file picker --- */}
          {!uploadData && !uploading && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Select a video file to upload. Supported formats: MP4, MOV, MKV, WebM, AVI.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp4,.mov,.mkv,.webm,.avi"
                  onChange={e => setVodFile(e.target.files?.[0] || null)}
                  className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:text-sm file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50 file:cursor-pointer file:transition-colors"
                />
                {vodFile && (
                  <button
                    onClick={handleUpload}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" /> Upload
                  </button>
                )}
              </div>
              {/* Show selected file info */}
              {vodFile && (
                <p className="text-xs text-gray-500">
                  {vodFile.name} — {formatFileSize(vodFile.size)}
                </p>
              )}
              {uploadError && (
                <p className="text-sm text-red-600">{uploadError}</p>
              )}
            </div>
          )}

          {/* --- State 2: Uploading — show browser-to-server progress --- */}
          {uploading && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Uploading {vodFile?.name}...
              </p>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500">{uploadProgress}% uploaded</p>
            </div>
          )}

          {/* --- State 3: Transcoding — show per-codec progress bars --- */}
          {uploadData && ['UPLOADING', 'UPLOADED', 'TRANSCODING'].includes(uploadData.status) && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                {uploadData.status === 'TRANSCODING'
                  ? 'Transcoding in progress — this may take a while depending on file size.'
                  : 'Processing upload...'}
              </p>
              {/* File info */}
              <p className="text-xs text-gray-500">
                {uploadData.fileName} — {formatFileSize(uploadData.fileSize)}
              </p>
              {/* Transcode job progress bars */}
              {uploadData.transcodeJobs.length > 0 && (
                <div className="space-y-2">
                  {uploadData.transcodeJobs.map(job => (
                    <div key={job.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-gray-700">{job.codec}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${
                          job.status === 'COMPLETED' ? 'bg-green-50 text-green-700'
                          : job.status === 'FAILED' ? 'bg-red-50 text-red-700'
                          : job.status === 'RUNNING' ? 'bg-blue-50 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {job.status}{job.progress != null && job.status === 'RUNNING' ? ` ${job.progress}%` : ''}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            job.status === 'COMPLETED' ? 'bg-green-500'
                            : job.status === 'FAILED' ? 'bg-red-500'
                            : 'bg-blue-500'
                          }`}
                          style={{ width: `${job.status === 'COMPLETED' ? 100 : (job.progress ?? 0)}%` }}
                        />
                      </div>
                      {job.errorMessage && (
                        <p className="text-xs text-red-600">{job.errorMessage}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* --- State 4: Ready — show success badge and re-upload option --- */}
          {uploadData?.status === 'READY' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800">VOD Ready ✓</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    {uploadData.fileName} — {formatFileSize(uploadData.fileSize)}
                    {uploadData.duration != null && ` — ${formatDuration(uploadData.duration)}`}
                  </p>
                </div>
              </div>
              {/* Re-upload flow: confirm before deleting */}
              {!confirmReupload ? (
                <button
                  onClick={() => setConfirmReupload(true)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Delete &amp; Re-upload
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Delete current VOD and upload a new file?</span>
                  <button
                    onClick={handleDeleteUpload}
                    disabled={actionLoading === 'delete-upload'}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    {actionLoading === 'delete-upload' ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmReupload(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* --- State 5: Failed — show error and retry/re-upload buttons --- */}
          {uploadData?.status === 'FAILED' && (
            <div className="space-y-3">
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-800">Upload Failed</p>
                <p className="text-xs text-red-700 mt-0.5">
                  {uploadData.errorMessage || 'An unexpected error occurred during processing.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleRetryTranscode}
                  disabled={actionLoading === 'retry-transcode'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${actionLoading === 'retry-transcode' ? 'animate-spin' : ''}`} />
                  {actionLoading === 'retry-transcode' ? 'Retrying...' : 'Retry Transcoding'}
                </button>
                <button
                  onClick={handleDeleteUpload}
                  disabled={actionLoading === 'delete-upload'}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {actionLoading === 'delete-upload' ? 'Deleting...' : 'Delete & Try Again'}
                </button>
              </div>
              {uploadError && (
                <p className="text-sm text-red-600">{uploadError}</p>
              )}
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

      <IngestQrDialog
        eventName={event.title}
        ingest={ingest}
        kind={selectedIngestQr}
        open={selectedIngestQr !== null}
        onOpenChange={(open) => { if (!open) setSelectedIngestQr(null); }}
      />
    </div>
  );
}
