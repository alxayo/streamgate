'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, RefreshCw, Pencil, AlertTriangle, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface ConfigEntry {
  key: string;
  maskedValue: string | null;
  source: 'env' | 'database' | 'not_set';
  updatedAt: string | null;
}

export default function AdminConfigPage() {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Regenerate confirmation dialog
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const fetchEntries = async () => {
    try {
      const res = await fetch('/api/admin/config');
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const { data } = await res.json();
      setEntries(data);
    } catch {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleEdit = (key: string) => {
    clearMessages();
    setEditingKey(key);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const handleSave = async () => {
    if (!editingKey || !editValue.trim()) return;
    setSaving(true);
    clearMessages();

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: editingKey, value: editValue }),
      });

      if (res.ok) {
        setSuccess(`${editingKey} updated successfully`);
        setTimeout(() => setSuccess(''), 3000);
        setEditingKey(null);
        setEditValue('');
        await fetchEntries();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!regenKey) return;
    setRegenerating(true);
    clearMessages();

    try {
      const res = await fetch('/api/admin/config/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: regenKey }),
      });

      if (res.ok) {
        setSuccess(`${regenKey} regenerated successfully`);
        setTimeout(() => setSuccess(''), 3000);
        setRegenKey(null);
        await fetchEntries();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to regenerate');
      }
    } catch {
      setError('Network error');
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Shared Secrets</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage shared secrets used by Platform and HLS Server. Values set via environment
          variables take precedence over database values.
        </p>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          Changes to secrets stored in the database take effect when services restart or refresh
          their configuration. Environment variable overrides are applied immediately on restart.
        </p>
      </div>

      {/* Status messages */}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      {/* Config table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-700">Key</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Value</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Source</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Updated</th>
              <th className="text-right px-4 py-3 font-medium text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.key} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-gray-900">{entry.key}</td>
                <td className="px-4 py-3">
                  {editingKey === entry.key ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="Enter new value"
                        className="bg-white border-gray-300 text-gray-900 h-8 text-xs w-48"
                        autoFocus
                      />
                      <button
                        onClick={handleSave}
                        disabled={saving || !editValue.trim()}
                        className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                        title="Save"
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-1 text-gray-400 hover:text-gray-600"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`font-mono text-xs ${entry.maskedValue ? 'text-gray-600' : 'text-gray-400 italic'}`}
                    >
                      {entry.maskedValue ?? 'Not set'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      entry.source === 'env'
                        ? 'bg-blue-100 text-blue-700'
                        : entry.source === 'database'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {entry.source === 'env' ? 'ENV' : entry.source === 'database' ? 'DB' : '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {entry.updatedAt
                    ? new Date(entry.updatedAt).toLocaleString()
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(entry.key)}
                      disabled={editingKey !== null}
                      className="h-7 px-2 text-gray-600 hover:text-gray-900"
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { clearMessages(); setRegenKey(entry.key); }}
                      disabled={editingKey !== null}
                      className="h-7 px-2 text-gray-600 hover:text-gray-900"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Regenerate
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Regenerate confirmation dialog */}
      <Dialog open={regenKey !== null} onOpenChange={(open) => { if (!open) setRegenKey(null); }}>
        <DialogContent className="bg-white border-gray-200">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Regenerate Secret</DialogTitle>
            <DialogDescription className="text-gray-500">
              This will generate a new random value for{' '}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded font-mono">{regenKey}</code>.
              Any service using the old value will lose access until it picks up the new one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRegenKey(null)}
              disabled={regenerating}
              className="border-gray-300 text-gray-700"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {regenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
