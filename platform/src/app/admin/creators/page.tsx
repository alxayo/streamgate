'use client';

// =========================================================================
// Admin Creators Management Page — /admin/creators
// =========================================================================
// Lists all registered creators with their status (active, pending, locked,
// suspended) and their channels. Admins can:
//   - Approve pending registrations
//   - Suspend / unsuspend creators
//   - Unlock locked-out accounts (brute-force lockout)
//   - Suspend / unsuspend individual channels
//
// Requires permission: creators:view (all roles except VIEWER_MANAGER)
// =========================================================================

import { useState, useEffect } from 'react';
import { Users, Shield, ShieldOff, CheckCircle, Unlock } from 'lucide-react';

interface CreatorItem {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  isPendingApproval: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  _count: { channels: number };
  channels: { id: string; name: string; slug: string; isActive: boolean }[];
}

export default function AdminCreatorsPage() {
  const [creators, setCreators] = useState<CreatorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchCreators = (query?: string) => {
    const params = new URLSearchParams();
    if (query) params.set('search', query);
    fetch(`/api/admin/creators?${params}`)
      .then(res => res.json())
      .then(data => setCreators(data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCreators(); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    fetchCreators(search);
  };

  const toggleCreator = async (id: string, isActive: boolean) => {
    await fetch(`/api/admin/creators/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchCreators(search);
  };

  const approveCreator = async (id: string) => {
    await fetch(`/api/admin/creators/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve: true }),
    });
    fetchCreators(search);
  };

  const unlockCreator = async (id: string) => {
    await fetch(`/api/admin/creators/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlock: true }),
    });
    fetchCreators(search);
  };

  const toggleChannel = async (id: string, isActive: boolean) => {
    await fetch(`/api/admin/channels/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    fetchCreators(search);
  };

  const isLocked = (creator: CreatorItem) =>
    creator.lockedUntil && new Date(creator.lockedUntil) > new Date();

  const getStatusBadge = (creator: CreatorItem) => {
    if (creator.isPendingApproval) {
      return <span className="text-xs px-2 py-1 rounded-full bg-yellow-50 text-yellow-700">Pending Approval</span>;
    }
    if (isLocked(creator)) {
      return <span className="text-xs px-2 py-1 rounded-full bg-orange-50 text-orange-700">Locked</span>;
    }
    if (creator.isActive) {
      return <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700">Active</span>;
    }
    return <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-700">Suspended</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Creators & Channels</h1>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="flex-1 max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button type="submit" className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors">
          Search
        </button>
      </form>

      {loading ? (
        <div className="text-gray-500 animate-pulse">Loading...</div>
      ) : creators.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Users className="h-8 w-8 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">No creators registered yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {creators.map(creator => (
            <div key={creator.id} className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium text-gray-900">{creator.displayName}</p>
                  <p className="text-sm text-gray-500">{creator.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(creator)}

                  {/* Approve button — only for pending creators */}
                  {creator.isPendingApproval && (
                    <button
                      onClick={() => approveCreator(creator.id)}
                      className="p-1.5 rounded-md text-green-600 hover:bg-green-50 transition-colors"
                      title="Approve creator"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </button>
                  )}

                  {/* Unlock button — only for locked creators */}
                  {isLocked(creator) && (
                    <button
                      onClick={() => unlockCreator(creator.id)}
                      className="p-1.5 rounded-md text-orange-600 hover:bg-orange-50 transition-colors"
                      title="Unlock account"
                    >
                      <Unlock className="h-4 w-4" />
                    </button>
                  )}

                  {/* Suspend/unsuspend — not shown for pending creators */}
                  {!creator.isPendingApproval && (
                    <button
                      onClick={() => toggleCreator(creator.id, creator.isActive)}
                      className={`p-1.5 rounded-md transition-colors ${
                        creator.isActive
                          ? 'text-red-600 hover:bg-red-50'
                          : 'text-green-600 hover:bg-green-50'
                      }`}
                      title={creator.isActive ? 'Suspend creator' : 'Unsuspend creator'}
                    >
                      {creator.isActive ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>

              {/* Channels */}
              {creator.channels.length > 0 && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Channels</p>
                  {creator.channels.map(ch => (
                    <div key={ch.id} className="flex items-center justify-between pl-3">
                      <div>
                        <span className="text-sm font-medium text-gray-800">{ch.name}</span>
                        <span className="ml-2 text-xs text-gray-400">/{ch.slug}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          ch.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {ch.isActive ? 'Active' : 'Suspended'}
                        </span>
                        <button
                          onClick={() => toggleChannel(ch.id, ch.isActive)}
                          className={`p-1 rounded transition-colors ${
                            ch.isActive
                              ? 'text-red-500 hover:bg-red-50'
                              : 'text-green-500 hover:bg-green-50'
                          }`}
                          title={ch.isActive ? 'Suspend channel' : 'Unsuspend channel'}
                        >
                          {ch.isActive ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-400 mt-3">
                Joined {new Date(creator.createdAt).toLocaleDateString()}
                {creator.lastLoginAt && ` · Last login ${new Date(creator.lastLoginAt).toLocaleDateString()}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
