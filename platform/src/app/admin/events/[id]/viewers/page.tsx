'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, RefreshCw, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Viewer {
  sessionId: string;
  tokenCode: string;
  tokenLabel: string | null;
  clientIp: string;
  userAgent: string | null;
  lastHeartbeat: string;
  sessionStarted: string;
  redeemedAt: string | null;
}

interface ViewersData {
  event: { id: string; title: string; streamType: string };
  viewers: Viewer[];
  totalViewers: number;
}

function formatDuration(startIso: string): string {
  const seconds = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function parseBrowser(ua: string | null): string {
  if (!ua) return 'Unknown';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';
  return 'Other';
}

function parseOS(ua: string | null): string {
  if (!ua) return 'Unknown';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Linux')) return 'Linux';
  return 'Other';
}

export default function EventViewersPage() {
  const params = useParams();
  const eventId = params.id as string;

  const [data, setData] = useState<ViewersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchViewers = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/events/${eventId}/viewers`);
      const json = await res.json();
      setData(json.data);
    } catch {
      console.error('Failed to fetch viewers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchViewers();
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => fetchViewers(), 10_000);
    return () => clearInterval(interval);
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="text-gray-400">Loading viewers...</div>;
  if (!data) return <div className="text-gray-400">Event not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/events/${eventId}`}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Active Viewers</h1>
            <p className="text-sm text-gray-500">{data.event.title}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-green-600">
            <Users className="h-4 w-4" />
            <span className="text-lg font-semibold">{data.totalViewers}</span>
            <span className="text-sm text-gray-500">watching now</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50"
            onClick={() => fetchViewers(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Viewers Table */}
      {data.viewers.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <Monitor className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No active viewers right now</p>
          <p className="text-xs text-gray-400 mt-1">This page auto-refreshes every 10 seconds</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Token</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Label</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">IP Address</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Browser</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">OS</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Watch Time</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Last Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {data.viewers.map((viewer) => (
                <tr key={viewer.sessionId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <code className="font-mono text-sm tracking-wider text-gray-900">{viewer.tokenCode}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {viewer.tokenLabel || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-sm text-gray-700">{viewer.clientIp}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {parseBrowser(viewer.userAgent)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {parseOS(viewer.userAgent)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {formatDuration(viewer.sessionStarted)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
                      <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      {formatTimeAgo(viewer.lastHeartbeat)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">Auto-refreshes every 10 seconds</p>
    </div>
  );
}
