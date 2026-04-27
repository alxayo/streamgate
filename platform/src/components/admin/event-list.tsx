'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, MoreHorizontal, Archive, Power, Trash2, Edit, Users, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EventStatusBadge } from './event-status-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Event {
  id: string;
  title: string;
  streamType: string;
  startsAt: string;
  endsAt: string;
  accessWindowHours: number;
  isActive: boolean;
  isArchived: boolean;
  activeViewers: number;
  rtmpToken?: string | null;
  rtmpStreamKeyHash?: string | null;
  _count: { tokens: number };
}

export function EventList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('active');
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyStreamKey = (event: Event) => {
    const key = event.rtmpStreamKeyHash
      ? `live/${event.rtmpStreamKeyHash}`
      : `live/${event.id}`;
    navigator.clipboard.writeText(key);
    setCopiedId(event.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/events?status=${status}`);
      const data = await res.json();
      setEvents(data.data || []);
    } catch {
      console.error('Failed to fetch events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = async (eventId: string, action: string) => {
    setActionMenu(null);
    try {
      if (action === 'deactivate' || action === 'reactivate' || action === 'archive' || action === 'unarchive') {
        await fetch(`/api/admin/events/${eventId}/${action}`, { method: 'PATCH' });
      }
      fetchEvents();
    } catch {
      console.error(`Failed to ${action} event`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[140px] bg-white border-gray-300 text-gray-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-gray-200 text-gray-900">
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Link href="/admin/events/new">
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Create Event
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading events...</div>
      ) : events.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No {status} events found.
          {status === 'active' && (
            <div className="mt-2">
              <Link href="/admin/events/new">
                <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50">
                  Create your first event
                </Button>
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Title</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Stream Key</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Starts</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Ends</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Window</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Tokens</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Viewers</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/events/${event.id}`} className="text-sm font-medium text-accent-blue hover:underline">
                      {event.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {event.streamType === 'LIVE' ? (
                      <div className="flex items-center gap-1">
                        <code className="text-xs font-mono text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded">
                          {event.rtmpStreamKeyHash
                            ? `live/${event.rtmpStreamKeyHash.length > 20 ? event.rtmpStreamKeyHash.slice(0, 20) + '…' : event.rtmpStreamKeyHash}`
                            : `live/${event.id.slice(0, 8)}…`}
                        </code>
                        <button
                          onClick={() => copyStreamKey(event)}
                          className="p-0.5 text-gray-400 hover:text-gray-700"
                          title="Copy full stream key"
                        >
                          {copiedId === event.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      event.streamType === 'VOD'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {event.streamType === 'VOD' ? 'VOD' : 'Live'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(event.startsAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(event.endsAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{event.accessWindowHours}h</td>
                  <td className="px-4 py-3">
                    <EventStatusBadge isActive={event.isActive} isArchived={event.isArchived} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{event._count.tokens}</td>
                  <td className="px-4 py-3">
                    {event.activeViewers > 0 ? (
                      <Link
                        href={`/admin/events/${event.id}/viewers`}
                        className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-700 font-medium"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {event.activeViewers}
                      </Link>
                    ) : (
                      <span className="text-sm text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right relative">
                    <button
                      onClick={() => setActionMenu(actionMenu === event.id ? null : event.id)}
                      className="p-1 hover:bg-gray-100 rounded"
                    >
                      <MoreHorizontal className="h-4 w-4 text-gray-500" />
                    </button>
                    {actionMenu === event.id && (
                      <div className="absolute right-4 top-10 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 min-w-[140px]">
                        <Link
                          href={`/admin/events/${event.id}/edit`}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full"
                          onClick={() => setActionMenu(null)}
                        >
                          <Edit className="h-3.5 w-3.5" /> Edit
                        </Link>
                        {event.isActive ? (
                          <button
                            onClick={() => handleAction(event.id, 'deactivate')}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full text-left"
                          >
                            <Power className="h-3.5 w-3.5" /> Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAction(event.id, 'reactivate')}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full text-left"
                          >
                            <Power className="h-3.5 w-3.5" /> Reactivate
                          </button>
                        )}
                        {event.isArchived ? (
                          <button
                            onClick={() => handleAction(event.id, 'unarchive')}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full text-left"
                          >
                            <Archive className="h-3.5 w-3.5" /> Unarchive
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAction(event.id, 'archive')}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full text-left"
                          >
                            <Archive className="h-3.5 w-3.5" /> Archive
                          </button>
                        )}
                      </div>
                    )}
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
