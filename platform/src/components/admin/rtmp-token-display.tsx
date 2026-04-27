'use client';

import { useState } from 'react';
import { Copy, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RtmpTokenDisplayProps {
  eventId: string;
  rtmpToken?: string | null;
  rtmpStreamKeyHash?: string | null;
  onTokenRotate?: () => Promise<void>;
  loading?: boolean;
}

export function RtmpTokenDisplay({
  eventId,
  rtmpToken,
  rtmpStreamKeyHash,
  onTokenRotate,
  loading = false,
}: RtmpTokenDisplayProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleRotateToken = async () => {
    if (!onTokenRotate) return;
    setRotating(true);
    try {
      await onTokenRotate();
    } finally {
      setRotating(false);
    }
  };

  if (!rtmpToken || !rtmpStreamKeyHash) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-sm text-yellow-800">
          ⚠️ RTMP tokens not yet generated. Event may have been created before the feature was deployed.
        </p>
      </div>
    );
  }

  // Build the full RTMP URL
  const rtmpUrl = `rtmp://your-rtmp-server:1935/live/${rtmpStreamKeyHash}`;
  const ffmpegExample = `ffmpeg -f lavfi -i testsrc=s=1280x720:d=1 -f lavfi -i sine=f=1000:d=1 -c:v libx264 -c:a aac "${rtmpUrl}?token=${rtmpToken}"`;

  return (
    <div className="space-y-4 bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">📡 RTMP Authentication</h3>
        <p className="text-xs text-gray-600 mb-4">
          Unique credentials for this event's RTMP stream. Each event has its own token for security.
        </p>
      </div>

      {/* Stream Key Hash */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">Stream Key Hash</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-gray-800 bg-white border border-gray-300 rounded px-3 py-2 break-all">
            {rtmpStreamKeyHash}
          </code>
          <button
            onClick={() => copyToClipboard(rtmpStreamKeyHash, 'hash')}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
            title="Copy stream key hash"
          >
            {copiedField === 'hash' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Use this as the stream name in your RTMP encoder settings.
        </p>
      </div>

      {/* RTMP Token */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">RTMP Token</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-gray-800 bg-white border border-gray-300 rounded px-3 py-2 break-all">
            {rtmpToken}
          </code>
          <button
            onClick={() => copyToClipboard(rtmpToken, 'token')}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
            title="Copy RTMP token"
          >
            {copiedField === 'token' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Pass this as a query parameter: <code className="bg-white px-1 rounded">?token=...</code>
        </p>
      </div>

      {/* Full RTMP URL */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">RTMP URL</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-gray-800 bg-white border border-gray-300 rounded px-3 py-2 break-all">
            {rtmpUrl}
          </code>
          <button
            onClick={() => copyToClipboard(rtmpUrl, 'url')}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
            title="Copy RTMP URL"
          >
            {copiedField === 'url' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* FFmpeg Example */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-2">FFmpeg Example</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-gray-800 bg-white border border-gray-300 rounded px-3 py-2 break-all overflow-auto max-h-16">
            {ffmpegExample}
          </code>
          <button
            onClick={() => copyToClipboard(ffmpegExample, 'ffmpeg')}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
            title="Copy FFmpeg command"
          >
            {copiedField === 'ffmpeg' ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Token Rotation */}
      {onTokenRotate && (
        <div className="border-t border-gray-300 pt-4">
          <Button
            onClick={handleRotateToken}
            disabled={rotating || loading}
            variant="outline"
            size="sm"
            className="w-full text-gray-700 border-gray-300 hover:bg-white"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${rotating ? 'animate-spin' : ''}`} />
            {rotating ? 'Rotating Token...' : 'Rotate Token'}
          </Button>
          <p className="text-xs text-gray-500 mt-2">
            Generate a new token. Existing streams will be disconnected.
          </p>
        </div>
      )}

      {/* Security Notes */}
      <div className="border-t border-gray-300 pt-4">
        <p className="text-xs font-medium text-gray-700 mb-2">🔒 Security Notes:</p>
        <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
          <li>Each event has a unique token for isolation</li>
          <li>Tokens expire at the event end time</li>
          <li>Only one active stream per event allowed</li>
          <li>Token changes revoke existing connections</li>
        </ul>
      </div>
    </div>
  );
}
