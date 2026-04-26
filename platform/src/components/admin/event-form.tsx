'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TranscoderConfig, PlayerConfig } from '@streaming/shared';

/** Inline tooltip — shows help text on hover next to a label. */
function Tip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1">
      <Info className="h-3 w-3 text-gray-400 cursor-help" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 text-xs text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {text}
      </span>
    </span>
  );
}

interface EventFormProps {
  initialData?: {
    id: string;
    title: string;
    description: string | null;
    streamType: string;
    streamUrl: string | null;
    posterUrl: string | null;
    startsAt: string;
    endsAt: string;
    accessWindowHours: number;
    autoPurge: boolean;
    transcoderConfig?: string | null; // JSON string or null (use system defaults)
    playerConfig?: string | null;     // JSON string or null (use system defaults)
  };
}

export function EventForm({ initialData }: EventFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;

  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    description: initialData?.description || '',
    streamType: initialData?.streamType || 'LIVE',
    streamUrl: initialData?.streamUrl || '',
    posterUrl: initialData?.posterUrl || '',
    startsAt: initialData?.startsAt ? new Date(initialData.startsAt).toISOString().slice(0, 16) : '',
    endsAt: initialData?.endsAt ? new Date(initialData.endsAt).toISOString().slice(0, 16) : '',
    accessWindowHours: initialData?.accessWindowHours || 48,
    autoPurge: initialData?.autoPurge ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // --- Per-event stream config (Advanced Settings) ---
  // When useCustomConfig is false, the event inherits system defaults (config fields stay null).
  // When true, the admin can override individual settings for this specific event.
  const [useCustomConfig, setUseCustomConfig] = useState(
    !!(initialData?.transcoderConfig || initialData?.playerConfig)
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Parse existing per-event config if editing an event that has overrides
  const parsedTranscoder = initialData?.transcoderConfig
    ? JSON.parse(initialData.transcoderConfig) as Partial<TranscoderConfig>
    : null;
  const parsedPlayer = initialData?.playerConfig
    ? JSON.parse(initialData.playerConfig) as Partial<PlayerConfig>
    : null;

  // System defaults — fetched on mount so we can show "Using default: X" labels
  const [systemDefaults, setSystemDefaults] = useState<{ transcoder: TranscoderConfig; player: PlayerConfig } | null>(null);

  // Per-event override values (initialized from existing overrides or system defaults)
  const [transcoderOverrides, setTranscoderOverrides] = useState<Partial<TranscoderConfig>>({
    profile: parsedTranscoder?.profile,
    hlsTime: parsedTranscoder?.hlsTime,
    hlsListSize: parsedTranscoder?.hlsListSize,
    forceKeyFrameInterval: parsedTranscoder?.forceKeyFrameInterval,
    h264: parsedTranscoder?.h264,
  });
  const [playerOverrides, setPlayerOverrides] = useState<Partial<PlayerConfig>>({
    liveSyncDurationCount: parsedPlayer?.liveSyncDurationCount,
    liveMaxLatencyDurationCount: parsedPlayer?.liveMaxLatencyDurationCount,
    backBufferLength: parsedPlayer?.backBufferLength,
    lowLatencyMode: parsedPlayer?.lowLatencyMode,
  });

  // Fetch system defaults on mount (for "Using default: X" display)
  useEffect(() => {
    fetch('/api/admin/settings')
      .then(res => res.json())
      .then(({ data }) => {
        setSystemDefaults(data);
        // Pre-fill override fields with system defaults if no existing overrides
        if (!parsedTranscoder) {
          setTranscoderOverrides({
            profile: data.transcoder.profile,
            hlsTime: data.transcoder.hlsTime,
            hlsListSize: data.transcoder.hlsListSize,
            forceKeyFrameInterval: data.transcoder.forceKeyFrameInterval,
            h264: { ...data.transcoder.h264 },
          });
        }
        if (!parsedPlayer) {
          setPlayerOverrides({
            liveSyncDurationCount: data.player.liveSyncDurationCount,
            liveMaxLatencyDurationCount: data.player.liveMaxLatencyDurationCount,
            backBufferLength: data.player.backBufferLength,
            lowLatencyMode: data.player.lowLatencyMode,
          });
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const url = isEditing ? `/api/admin/events/${initialData.id}` : '/api/admin/events';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          startsAt: new Date(formData.startsAt).toISOString(),
          endsAt: new Date(formData.endsAt).toISOString(),
          description: formData.description || null,
          streamType: formData.streamType,
          streamUrl: formData.streamUrl || null,
          posterUrl: formData.posterUrl || null,
          autoPurge: formData.autoPurge,
          // Include per-event config overrides only if the admin enabled custom config.
          // null means "use system defaults" (inheritance by omission).
          transcoderConfig: useCustomConfig ? transcoderOverrides : null,
          playerConfig: useCustomConfig ? playerOverrides : null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/admin/events/${data.data.id}`);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save event');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <Label className="text-gray-700">Title *</Label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="bg-white border-gray-300 text-gray-900"
          required
        />
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Stream Type *</Label>
        <Select value={formData.streamType} onValueChange={(v) => setFormData({ ...formData, streamType: v })}>
          <SelectTrigger className="w-[180px] bg-white border-gray-300 text-gray-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-white border-gray-200 text-gray-900">
            <SelectItem value="LIVE">Live</SelectItem>
            <SelectItem value="VOD">VOD</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.streamType === 'LIVE' && (
        <div className="space-y-2">
          <Label className="text-gray-700">Auto-purge on publish</Label>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="autoPurge"
                checked={formData.autoPurge === true}
                onChange={() => setFormData({ ...formData, autoPurge: true })}
                className="h-4 w-4 border-gray-300 text-accent-blue focus:ring-accent-blue"
              />
              <span className="text-sm text-gray-900">On</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="autoPurge"
                checked={formData.autoPurge === false}
                onChange={() => setFormData({ ...formData, autoPurge: false })}
                className="h-4 w-4 border-gray-300 text-accent-blue focus:ring-accent-blue"
              />
              <span className="text-sm text-gray-900">Off</span>
            </label>
          </div>
          <p className="text-xs text-gray-500">
            When On, existing HLS segments and blobs are deleted before a new RTMP publish starts for this event.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-gray-700">Description</Label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent-blue"
          rows={3}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-gray-700">Start Date/Time *</Label>
          <Input
            type="datetime-local"
            value={formData.startsAt}
            onChange={(e) => setFormData({ ...formData, startsAt: e.target.value })}
            className="bg-white border-gray-300 text-gray-900"
            required
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-700">End Date/Time *</Label>
          <Input
            type="datetime-local"
            value={formData.endsAt}
            onChange={(e) => setFormData({ ...formData, endsAt: e.target.value })}
            className="bg-white border-gray-300 text-gray-900"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Access Window (hours after event ends)</Label>
        <Input
          type="number"
          value={formData.accessWindowHours}
          onChange={(e) => setFormData({ ...formData, accessWindowHours: parseInt(e.target.value) || 48 })}
          className="bg-white border-gray-300 text-gray-900 w-32"
          min={1}
          max={168}
        />
        <p className="text-xs text-gray-500">1-168 hours (default: 48)</p>
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Stream URL Override (optional)</Label>
        <Input
          value={formData.streamUrl}
          onChange={(e) => setFormData({ ...formData, streamUrl: e.target.value })}
          className="bg-white border-gray-300 text-gray-900"
          placeholder="https://..."
        />
        <p className="text-xs text-gray-500">
          Leave blank for convention-based paths. Only needed for non-standard upstream origins.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-gray-700">Poster URL (optional)</Label>
        <Input
          value={formData.posterUrl}
          onChange={(e) => setFormData({ ...formData, posterUrl: e.target.value })}
          className="bg-white border-gray-300 text-gray-900"
          placeholder="https://..."
        />
      </div>

      {/* ================================================================
          ADVANCED STREAM SETTINGS — per-event overrides (collapsed by default)
          Only shown for LIVE stream type. Controls transcoder + player settings.
          ================================================================ */}
      {formData.streamType === 'LIVE' && (
        <div className="border border-gray-200 rounded-lg bg-white">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full px-4 py-3 text-left font-medium text-gray-900"
          >
            <span>Advanced Stream Settings</span>
            {showAdvanced
              ? <ChevronDown className="h-4 w-4 text-gray-500" />
              : <ChevronRight className="h-4 w-4 text-gray-500" />}
          </button>

          {showAdvanced && (
            <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">
              {/* Toggle: use system defaults vs custom overrides */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCustomConfig}
                    onChange={(e) => setUseCustomConfig(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-accent-blue focus:ring-accent-blue"
                  />
                  <span className="text-sm text-gray-900">Override system defaults for this event</span>
                </label>
              </div>

              {!useCustomConfig && (
                <p className="text-sm text-gray-500">
                  This event uses system-wide defaults from{' '}
                  <a href="/admin/settings" className="text-accent-blue underline">Settings</a>.
                </p>
              )}

              {useCustomConfig && systemDefaults && (
                <>
                  {/* --- Transcoder overrides --- */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-gray-700 uppercase tracking-wider">Transcoder</h4>

                    {/* Profile */}
                    <div className="space-y-1">
                      <Label className="text-gray-700 text-sm">Rendition Profile</Label>
                      <Select
                        value={transcoderOverrides.profile || systemDefaults.transcoder.profile}
                        onValueChange={(v) => setTranscoderOverrides({ ...transcoderOverrides, profile: v as TranscoderConfig['profile'] })}
                      >
                        <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-gray-200 text-gray-900">
                          <SelectItem value="full-abr-1080p-720p-480p">Full ABR (1080p copy + 720p + 480p)</SelectItem>
                          <SelectItem value="low-latency-1080p-720p-480p">Low Latency (all transcoded)</SelectItem>
                          <SelectItem value="low-latency-720p-480p">Low Latency (720p + 480p)</SelectItem>
                          <SelectItem value="passthrough-only">Passthrough Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Segment duration */}
                    <div className="space-y-1">
                      <Label className="text-gray-700 text-sm">
                        Segment Duration (seconds)
                        <Tip text="Lower = less latency. 2s recommended." />
                      </Label>
                      <Input
                        type="number"
                        value={transcoderOverrides.hlsTime ?? systemDefaults.transcoder.hlsTime}
                        onChange={(e) => setTranscoderOverrides({ ...transcoderOverrides, hlsTime: parseInt(e.target.value) || 2 })}
                        className="bg-white border-gray-300 text-gray-900 w-24"
                        min={1} max={10}
                      />
                    </div>

                    {/* H.264 tune */}
                    <div className="space-y-1">
                      <Label className="text-gray-700 text-sm">
                        Zero Latency
                        <Tip text="Disables B-frames for ~0.5s less encoding latency. Only affects transcoded renditions." />
                      </Label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(transcoderOverrides.h264?.tune ?? systemDefaults.transcoder.h264.tune) === 'zerolatency'}
                          onChange={(e) =>
                            setTranscoderOverrides({
                              ...transcoderOverrides,
                              h264: {
                                ...(transcoderOverrides.h264 || systemDefaults.transcoder.h264),
                                tune: e.target.checked ? 'zerolatency' : 'none',
                              },
                            })
                          }
                          className="h-4 w-4 rounded border-gray-300 text-accent-blue focus:ring-accent-blue"
                        />
                        <span className="text-sm text-gray-900">Enable</span>
                      </label>
                    </div>

                    {/* H.264 preset */}
                    <div className="space-y-1">
                      <Label className="text-gray-700 text-sm">
                        H.264 Preset
                        <Tip text="Encoding speed. Ultrafast = lowest CPU + latency." />
                      </Label>
                      <Select
                        value={transcoderOverrides.h264?.preset ?? systemDefaults.transcoder.h264.preset}
                        onValueChange={(v) =>
                          setTranscoderOverrides({
                            ...transcoderOverrides,
                            h264: {
                              ...(transcoderOverrides.h264 || systemDefaults.transcoder.h264),
                              preset: v as 'ultrafast' | 'superfast' | 'veryfast',
                            },
                          })
                        }
                      >
                        <SelectTrigger className="w-[180px] bg-white border-gray-300 text-gray-900">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-gray-200 text-gray-900">
                          <SelectItem value="ultrafast">Ultrafast</SelectItem>
                          <SelectItem value="superfast">Superfast</SelectItem>
                          <SelectItem value="veryfast">Veryfast</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* --- Player overrides --- */}
                  <div className="space-y-3 pt-2 border-t border-gray-100">
                    <h4 className="text-sm font-medium text-gray-700 uppercase tracking-wider">Player</h4>

                    {/* Live sync */}
                    <div className="space-y-1">
                      <Label className="text-gray-700 text-sm">
                        Live Sync (segments behind edge)
                        <Tip text="How many segments behind live edge. Lower = closer to real-time." />
                      </Label>
                      <Input
                        type="number"
                        value={playerOverrides.liveSyncDurationCount ?? systemDefaults.player.liveSyncDurationCount}
                        onChange={(e) => setPlayerOverrides({ ...playerOverrides, liveSyncDurationCount: parseInt(e.target.value) || 2 })}
                        className="bg-white border-gray-300 text-gray-900 w-24"
                        min={1} max={10}
                      />
                    </div>

                    {/* Low latency mode */}
                    <div className="space-y-1">
                      <Label className="text-gray-700 text-sm">
                        Low Latency Mode
                        <Tip text="Enables hls.js aggressive live edge seeking." />
                      </Label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={playerOverrides.lowLatencyMode ?? systemDefaults.player.lowLatencyMode}
                          onChange={(e) => setPlayerOverrides({ ...playerOverrides, lowLatencyMode: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300 text-accent-blue focus:ring-accent-blue"
                        />
                        <span className="text-sm text-gray-900">Enable</span>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {isEditing ? 'Update Event' : 'Create Event'}
        </Button>
        <Button type="button" variant="outline" className="bg-white border-gray-300 text-gray-900 hover:bg-gray-50" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
