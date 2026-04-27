'use client';

// =========================================================================
// Creator Events List — /creator/events
// =========================================================================
// Displays all events belonging to the creator's active channel.
// Includes a "New Event" creation form (inline modal).
// Each event shows: title, type (LIVE/VOD), date range, token count,
// and a copy-to-clipboard stream key for LIVE events.
// =========================================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Calendar, Copy, Check } from 'lucide-react';

interface EventItem {
  id: string;
  title: string;
  streamType: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  rtmpStreamKeyHash?: string | null;
  _count: { tokens: number };
}

export default function CreatorEventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyStreamKey = (e: React.MouseEvent, event: EventItem) => {
    e.preventDefault();
    e.stopPropagation();
    const key = event.rtmpStreamKeyHash
      ? `live/${event.rtmpStreamKeyHash}`
      : `live/${event.id}`;
    navigator.clipboard.writeText(key);
    setCopiedId(event.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const fetchEvents = () => {
    fetch('/api/creator/events')
      .then(res => res.json())
      .then(data => setEvents(data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchEvents(); }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Events</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Event
        </button>
      </div>

      {showCreate && (
        <CreateEventForm
          onCreated={() => { setShowCreate(false); fetchEvents(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <div className="text-gray-500 animate-pulse">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Calendar className="h-8 w-8 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">No events yet. Create your first event to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {events.map(event => (
            <Link
              key={event.id}
              href={`/creator/events/${event.id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{event.title}</p>
                <p className="text-sm text-gray-500">
                  {new Date(event.startsAt).toLocaleDateString()} · {event.streamType} · {event._count.tokens} tokens
                </p>
                {event.streamType === 'LIVE' && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-xs text-gray-400">Key:</span>
                    <code className="text-xs font-mono text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded">
                      {event.rtmpStreamKeyHash
                        ? `live/${event.rtmpStreamKeyHash}`
                        : `live/${event.id}`}
                    </code>
                    <button
                      onClick={(e) => copyStreamKey(e, event)}
                      className="p-0.5 text-gray-400 hover:text-gray-700"
                      title="Copy stream key"
                    >
                      {copiedId === event.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                )}
              </div>
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${
                event.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {event.isActive ? 'Active' : 'Inactive'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateEventForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [streamType, setStreamType] = useState('LIVE');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/creator/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, streamType, startsAt, endsAt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create event');
        return;
      }
      onCreated();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Event</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            id="title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="streamType" className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              id="streamType"
              value={streamType}
              onChange={e => setStreamType(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              <option value="LIVE">Live</option>
              <option value="VOD">VOD</option>
            </select>
          </div>
          <div>
            <label htmlFor="startsAt" className="block text-sm font-medium text-gray-700 mb-1">Start</label>
            <input
              id="startsAt"
              type="datetime-local"
              value={startsAt}
              onChange={e => setStartsAt(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <div>
            <label htmlFor="endsAt" className="block text-sm font-medium text-gray-700 mb-1">End</label>
            <input
              id="endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={e => setEndsAt(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating...' : 'Create Event'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
