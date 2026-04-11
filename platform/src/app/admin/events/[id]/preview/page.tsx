'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { VideoPlayer } from '@/components/player/video-player';
import { LiveBadge, RecordingBadge } from '@/components/player/live-badge';

interface PreviewData {
  playbackToken: string;
  playbackBaseUrl: string;
  streamPath: string;
  tokenExpiresIn: number;
  event: {
    title: string;
    streamType: string;
  };
}

export default function AdminPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string>('');

  useEffect(() => {
    fetch(`/api/admin/events/${eventId}/preview`, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Failed to load preview' }));
          throw new Error(body.error || 'Failed to load preview');
        }
        return res.json();
      })
      .then((d: PreviewData) => {
        setData(d);
        tokenRef.current = d.playbackToken;
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [eventId]);

  const getToken = useCallback(() => tokenRef.current, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-gray-400">
        Loading preview...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-black text-gray-400 gap-4">
        <p>{error || 'Failed to load preview'}</p>
        <button
          onClick={() => router.back()}
          className="text-accent-blue hover:underline text-sm"
        >
          Back to event
        </button>
      </div>
    );
  }

  const streamUrl = `${data.playbackBaseUrl}${data.streamPath}`;
  const isLive = data.event.streamType === 'LIVE';

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-cinema-black/90 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="text-white text-sm font-medium truncate">{data.event.title}</span>
          {isLive ? <LiveBadge /> : <RecordingBadge />}
          <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full font-medium">
            Admin Preview
          </span>
        </div>
      </div>

      {/* Player */}
      <div className="flex-1 relative">
        <VideoPlayer
          streamUrl={streamUrl}
          isLive={isLive}
          getToken={getToken}
          onStreamError={(errorType) => {
            if (errorType === 'auth') {
              setError('Stream authentication failed. The preview token may have expired.');
            }
          }}
        />
      </div>
    </div>
  );
}
