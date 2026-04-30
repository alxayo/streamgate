'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Shield, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface RtmpPlayAllowlistEntry {
  id: string;
  cidr: string;
  label: string | null;
  createdAt: string;
}

// This panel lets admins manage which external IPs can directly RTMP PLAY an event.
export function RtmpPlayAccessList({ eventId }: { eventId: string }) {
  // entries is the server's current list of allowed IP/CIDR rules for this event.
  const [entries, setEntries] = useState<RtmpPlayAllowlistEntry[]>([]);

  // cidr and label hold the small add-rule form values.
  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');

  // Separate loading flags keep each button responsive and easy to reason about.
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingMine, setAddingMine] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load existing rules whenever the event page opens or changes event ID.
  const loadEntries = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/rtmp-play-ips`);
      const data = await res.json();
      if (res.ok) setEntries(data.data || []);
      else setError(data.error || 'Failed to load RTMP play access list');
    } catch {
      setError('Failed to load RTMP play access list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadEntries(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add a manually typed IP or CIDR range.
  const addEntry = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/events/${eventId}/rtmp-play-ips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cidr, label: label || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        // Put the new row at the top without waiting for another full reload.
        setEntries((prev) => [data.data, ...prev.filter((entry) => entry.id !== data.data.id)]);
        setCidr('');
        setLabel('');
        setSuccess('IP range added');
      } else {
        setError(data.error || 'Failed to add IP range');
      }
    } catch {
      setError('Failed to add IP range');
    } finally {
      setSaving(false);
      setTimeout(() => setSuccess(''), 2500);
    }
  };

  // Ask the server to detect this browser's current public IP and add it.
  const addCurrentIp = async () => {
    setAddingMine(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/admin/events/${eventId}/rtmp-play-ips/add-mine`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.data) {
        setEntries((prev) => [data.data, ...prev.filter((entry) => entry.id !== data.data.id)]);
        setSuccess(data.alreadyExists ? 'Current IP already listed' : 'Current IP added');
      } else {
        setError(data.error || 'Failed to add current IP');
      }
    } catch {
      setError('Failed to add current IP');
    } finally {
      setAddingMine(false);
      setTimeout(() => setSuccess(''), 2500);
    }
  };

  // Remove one rule from this event.
  const deleteEntry = async (entryId: string) => {
    setDeletingId(entryId);
    setError('');
    try {
      const res = await fetch(`/api/admin/events/${eventId}/rtmp-play-ips/${entryId}`, { method: 'DELETE' });
      if (res.ok) setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
      else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to remove IP range');
      }
    } catch {
      setError('Failed to remove IP range');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-gray-500" />
          <h3 className="font-medium text-gray-900">RTMP Play Access</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={addCurrentIp}
          disabled={addingMine}
          className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          {addingMine ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 mr-1" />}
          Add my current IP
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
        <Input
          value={cidr}
          onChange={(event) => setCidr(event.target.value)}
          placeholder="203.0.113.10 or 203.0.113.0/24"
          className="bg-white border-gray-300 text-gray-900"
        />
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          className="bg-white border-gray-300 text-gray-900"
        />
        <Button size="sm" onClick={addEntry} disabled={saving || !cidr.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
          Add
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && (
        <p className="inline-flex items-center gap-1 text-sm text-green-700">
          <Check className="h-3.5 w-3.5" /> {success}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading access list
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">No external RTMP play IPs listed.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">IP range</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Added</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 font-mono text-gray-900">{entry.cidr}</td>
                  <td className="px-3 py-2 text-gray-600">{entry.label || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(entry.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteEntry(entry.id)}
                      disabled={deletingId === entry.id}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      title="Remove IP range"
                    >
                      {deletingId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}