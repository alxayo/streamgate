'use client';

// =========================================================================
// Creator Dashboard — /creator
// =========================================================================
// Landing page after creator login. Shows channel overview:
//   - Channel name and description
//   - Stats cards: total events, total tokens issued
//   - Quick-link to create a new event
// =========================================================================

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, Ticket, Plus } from 'lucide-react';

interface ChannelData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  stats: { totalEvents: number; totalTokens: number };
}

export default function CreatorDashboardPage() {
  const [channel, setChannel] = useState<ChannelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/creator/channel')
      .then(res => res.json())
      .then(data => setChannel(data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="animate-pulse text-gray-500">Loading...</div>;
  }

  if (!channel) {
    return <div className="text-red-600">Failed to load channel data</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{channel.name}</h1>
        <Link
          href="/creator/events"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Event
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-blue-50 p-2">
              <Calendar className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Events</p>
              <p className="text-2xl font-semibold text-gray-900">{channel.stats.totalEvents}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-green-50 p-2">
              <Ticket className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Tokens</p>
              <p className="text-2xl font-semibold text-gray-900">{channel.stats.totalTokens}</p>
            </div>
          </div>
        </div>
      </div>

      {channel.description && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-medium text-gray-500 mb-2">Channel Description</h2>
          <p className="text-gray-700">{channel.description}</p>
        </div>
      )}
    </div>
  );
}
