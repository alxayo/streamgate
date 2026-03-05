'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { CalendarDays, Ticket, Plus, Sparkles, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DashboardData {
  activeEvents: number;
  totalTokens: number;
  tokenBreakdown: { unused: number; redeemed: number; expired: number; revoked: number };
  upcomingEvents: Array<{ id: string; title: string; startsAt: string }>;
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then((res) => res.json())
      .then((d) => setData(d.data))
      .catch(console.error);
  }, []);

  if (!data) return <div className="text-gray-400">Loading dashboard...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/admin/events/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5 mr-1" /> Create Event
            </Button>
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-accent-blue/10 flex items-center justify-center">
              <CalendarDays className="h-5 w-5 text-accent-blue" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{data.activeEvents}</p>
              <p className="text-sm text-gray-500">Active Events</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-status-active/10 flex items-center justify-center">
              <Ticket className="h-5 w-5 text-status-active" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{data.totalTokens}</p>
              <p className="text-sm text-gray-500">Total Tokens</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-status-unused/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-status-unused" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-gray-900">{data.tokenBreakdown.unused}</p>
              <p className="text-sm text-gray-500">Unused Tokens</p>
            </div>
          </div>
        </div>
      </div>

      {/* Token Breakdown */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Token Status Breakdown</h2>
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(data.tokenBreakdown).map(([status, count]) => (
            <div key={status} className="text-center">
              <p className="text-3xl font-semibold text-gray-900">{count}</p>
              <p className="text-sm text-gray-500 capitalize">{status}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming Events */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Events</h2>
        {data.upcomingEvents.length === 0 ? (
          <p className="text-gray-400 text-sm">No upcoming events</p>
        ) : (
          <div className="space-y-3">
            {data.upcomingEvents.map((event) => (
              <Link
                key={event.id}
                href={`/admin/events/${event.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <span className="font-medium text-gray-900">{event.title}</span>
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(event.startsAt).toLocaleString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
