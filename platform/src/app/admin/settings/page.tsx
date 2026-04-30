/**
 * Admin Settings Page
 * ====================
 * Allows admins to configure system-wide default settings for:
 *   1. Transcoder — how FFmpeg encodes live streams (segment duration, profile, codec settings)
 *   2. Player — how the viewer's hls.js player behaves (latency, buffer, sync)
 *   3. Creator Registration — self-service signup mode
 *   4. Upload Settings — max file size for video uploads
 *   5. VOD Codec Selection — which codecs are enabled for VOD transcoding
 *   6. VOD Rendition Ladders — per-codec quality level configuration
 *
 * These defaults apply to ALL new events unless overridden per-event.
 * Changes to system defaults are picked up automatically by events that
 * haven't been customized (inheritance by omission — see plan §1.6).
 *
 * The form is split into collapsible sections with tooltips explaining
 * each setting for non-technical admins.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Info, Save, ChevronDown, ChevronRight, Plus, Trash2, RotateCcw, Shield } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TranscoderConfig, PlayerConfig } from '@streaming/shared';
import { ALL_CODEC_NAMES, DEFAULT_VOD_RENDITIONS } from '@streaming/shared';
import type { VODRendition } from '@streaming/shared';

// ---------------------------------------------------------------------------
// Constants — codec display names and tooltips for the UI
// ---------------------------------------------------------------------------

/** Human-readable labels for each codec, shown next to checkboxes */
const CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  av1: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
};

/** Tooltip text explaining each codec's characteristics */
const CODEC_TOOLTIPS: Record<string, string> = {
  h264: 'Most compatible. Supported by all browsers and devices.',
  av1: 'Best compression efficiency. ~30% smaller files than H.264. Requires modern browsers.',
  vp8: 'Open-source codec by Google. Good compatibility, moderate compression.',
  vp9: 'Successor to VP8. Better compression than H.264, widely supported.',
};

/** Conversion factor: 1 GB = 1,073,741,824 bytes */
const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Tooltip component — shows a small info icon that reveals help text on hover.
 * Used next to every setting to explain what it does in plain language.
 */
function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1">
      <Info className="h-3.5 w-3.5 text-gray-400 cursor-help" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {text}
      </span>
    </span>
  );
}

/**
 * Collapsible section wrapper — wraps a group of settings with a toggle header.
 * Keeps the form manageable by hiding details until the admin wants to see them.
 */
function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-4 py-3 text-left font-medium text-gray-900"
      >
        {title}
        {open ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-4">{children}</div>}
    </div>
  );
}

export default function AdminSettingsPage() {
  // --- State ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Transcoder defaults form state
  const [transcoder, setTranscoder] = useState<TranscoderConfig>({
    codecs: ['h264'],
    profile: 'full-abr-1080p-720p-480p',
    hlsTime: 2,
    hlsListSize: 6,
    forceKeyFrameInterval: 2,
    h264: { tune: 'zerolatency', preset: 'ultrafast' },
  });

  // Player defaults form state
  const [player, setPlayer] = useState<PlayerConfig>({
    liveSyncDurationCount: 2,
    liveMaxLatencyDurationCount: 4,
    backBufferLength: 0,
    lowLatencyMode: true,
  });

  // Creator registration mode
  const [registrationMode, setRegistrationMode] = useState<'open' | 'approval' | 'disabled'>('open');

  // --- VOD settings state ---

  /**
   * maxUploadSizeGb — displayed in GB for readability.
   * Converted to/from bytes (BigInt string) when loading/saving via the API.
   */
  const [maxUploadSizeGb, setMaxUploadSizeGb] = useState<number>(5);

  /**
   * enabledCodecs — which codecs are currently enabled for VOD transcoding.
   * At least one must remain checked (validated on save).
   */
  const [enabledCodecs, setEnabledCodecs] = useState<string[]>(['h264']);

  /**
   * vodRenditions — per-codec rendition ladders.
   * Each key is a codec name, each value is an array of quality levels.
   * Only enabled codecs are shown in the UI, but we keep all data so
   * re-enabling a codec doesn't lose its previously configured renditions.
   */
  const [vodRenditions, setVodRenditions] = useState<Record<string, VODRendition[]>>(
    DEFAULT_VOD_RENDITIONS,
  );

  // --- Load current settings on mount ---
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/settings');
        if (res.ok) {
          const { data } = await res.json();
          setTranscoder(data.transcoder);
          setPlayer(data.player);
          if (data.creatorRegistrationMode) setRegistrationMode(data.creatorRegistrationMode);
          // Load VOD settings — convert bytes string to GB for the input
          if (data.maxUploadSizeBytes) {
            setMaxUploadSizeGb(Number(BigInt(data.maxUploadSizeBytes)) / BYTES_PER_GB);
          }
          if (data.enabledCodecs) setEnabledCodecs(data.enabledCodecs);
          if (data.vodRenditions) setVodRenditions(data.vodRenditions);
        }
      } catch {
        setError('Failed to load settings');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // --- Codec toggle handler ---
  /** Toggles a codec on/off. Ensures at least one codec remains enabled. */
  const handleCodecToggle = useCallback((codec: string, checked: boolean) => {
    setEnabledCodecs((prev) => {
      if (checked) {
        // Add the codec and ensure it has default renditions if none exist
        const updated = [...prev, codec];
        setVodRenditions((prevRenditions) => {
          if (!prevRenditions[codec] || prevRenditions[codec].length === 0) {
            return { ...prevRenditions, [codec]: DEFAULT_VOD_RENDITIONS[codec as keyof typeof DEFAULT_VOD_RENDITIONS] || [] };
          }
          return prevRenditions;
        });
        return updated;
      } else {
        // Remove the codec — but block if it's the last one
        const updated = prev.filter((c) => c !== codec);
        if (updated.length === 0) return prev; // Keep at least one
        return updated;
      }
    });
  }, []);

  // --- Rendition helpers ---

  /** Updates a single field of a rendition in a specific codec's ladder */
  const updateRendition = useCallback(
    (codec: string, index: number, field: keyof VODRendition, value: string | number) => {
      setVodRenditions((prev) => {
        const codecRenditions = [...(prev[codec] || [])];
        codecRenditions[index] = { ...codecRenditions[index], [field]: value };
        return { ...prev, [codec]: codecRenditions };
      });
    },
    [],
  );

  /** Removes a rendition from a codec's ladder (must keep at least one) */
  const removeRendition = useCallback((codec: string, index: number) => {
    setVodRenditions((prev) => {
      const codecRenditions = [...(prev[codec] || [])];
      if (codecRenditions.length <= 1) return prev; // Keep at least one
      codecRenditions.splice(index, 1);
      return { ...prev, [codec]: codecRenditions };
    });
  }, []);

  /** Adds a blank rendition row to a codec's ladder */
  const addRendition = useCallback((codec: string) => {
    setVodRenditions((prev) => {
      const codecRenditions = [...(prev[codec] || [])];
      codecRenditions.push({
        label: '',
        width: 0,
        height: 0,
        videoBitrate: '1000k',
        audioBitrate: '128k',
      });
      return { ...prev, [codec]: codecRenditions };
    });
  }, []);

  /** Resets a codec's renditions to the built-in defaults */
  const resetRenditionsToDefault = useCallback((codec: string) => {
    setVodRenditions((prev) => ({
      ...prev,
      [codec]: DEFAULT_VOD_RENDITIONS[codec as keyof typeof DEFAULT_VOD_RENDITIONS] || [],
    }));
  }, []);

  // --- Save handler ---
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    // Client-side validation: at least one codec must be enabled
    if (enabledCodecs.length === 0) {
      setError('At least one codec must be enabled');
      setSaving(false);
      return;
    }

    // Client-side validation: each enabled codec must have at least one rendition
    for (const codec of enabledCodecs) {
      if (!vodRenditions[codec] || vodRenditions[codec].length === 0) {
        setError(`Codec "${CODEC_LABELS[codec]}" must have at least one rendition`);
        setSaving(false);
        return;
      }
    }

    try {
      // Convert GB back to bytes (as a string, since BigInt can't be JSON-serialized)
      const uploadSizeBytes = Math.round(maxUploadSizeGb * BYTES_PER_GB).toString();

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcoder,
          player,
          creatorRegistrationMode: registrationMode,
          maxUploadSizeBytes: uploadSizeBytes,
          enabledCodecs,
          vodRenditions,
        }),
      });

      if (res.ok) {
        const { data } = await res.json();
        setTranscoder(data.transcoder);
        setPlayer(data.player);
        if (data.creatorRegistrationMode) setRegistrationMode(data.creatorRegistrationMode);
        if (data.maxUploadSizeBytes) {
          setMaxUploadSizeGb(Number(BigInt(data.maxUploadSizeBytes)) / BYTES_PER_GB);
        }
        if (data.enabledCodecs) setEnabledCodecs(data.enabledCodecs);
        if (data.vodRenditions) setVodRenditions(data.vodRenditions);
        setSuccess('Settings saved successfully');
        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save settings');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">System Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure default stream settings for all events. Per-event overrides can be set on individual events.
        </p>
      </div>

      {/* ================================================================
          TRANSCODER DEFAULTS SECTION
          Controls how FFmpeg encodes the live stream
          ================================================================ */}
      <Section title="Transcoder Defaults">
        {/* Rendition profile — which ABR ladder to use */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Rendition Profile
            <Tooltip text="Determines the quality levels available to viewers. Full ABR copies the 1080p source and transcodes lower tiers. Low-latency profiles re-encode everything for consistent keyframe alignment." />
          </Label>
          <Select
            value={transcoder.profile}
            onValueChange={(v) => setTranscoder({ ...transcoder, profile: v as TranscoderConfig['profile'] })}
          >
            <SelectTrigger className="bg-white border-gray-300 text-gray-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-gray-200 text-gray-900">
              <SelectItem value="full-abr-1080p-720p-480p">Full ABR (1080p copy + 720p + 480p)</SelectItem>
              <SelectItem value="low-latency-1080p-720p-480p">Low Latency (1080p + 720p + 480p, all transcoded)</SelectItem>
              <SelectItem value="low-latency-720p-480p">Low Latency (720p + 480p, no 1080p)</SelectItem>
              <SelectItem value="passthrough-only">Passthrough Only (single quality, no transcoding)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Segment duration — how long each HLS chunk is */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Segment Duration (seconds)
            <Tooltip text="Duration of each HLS segment. Lower values reduce latency but increase HTTP request overhead. 2s is recommended for low latency. SMB/file-mode deployments may need 3s." />
          </Label>
          <Input
            type="number"
            value={transcoder.hlsTime}
            onChange={(e) => setTranscoder({ ...transcoder, hlsTime: parseInt(e.target.value) || 2 })}
            className="bg-white border-gray-300 text-gray-900 w-24"
            min={1}
            max={10}
          />
        </div>

        {/* Playlist window — how many segments in the live playlist */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Playlist Window (segments)
            <Tooltip text="Number of segments in the live playlist. 6 segments × 2s = 12s of rewind buffer. Higher values allow more rewind but use more bandwidth." />
          </Label>
          <Input
            type="number"
            value={transcoder.hlsListSize}
            onChange={(e) => setTranscoder({ ...transcoder, hlsListSize: parseInt(e.target.value) || 6 })}
            className="bg-white border-gray-300 text-gray-900 w-24"
            min={3}
            max={20}
          />
        </div>

        {/* Keyframe interval — how often to force I-frames */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Keyframe Interval (seconds)
            <Tooltip text="Seconds between forced keyframes. Must be ≤ segment duration for clean segment boundaries. Lower = better seeking but slightly larger files." />
          </Label>
          <Input
            type="number"
            value={transcoder.forceKeyFrameInterval}
            onChange={(e) => setTranscoder({ ...transcoder, forceKeyFrameInterval: parseInt(e.target.value) || 2 })}
            className="bg-white border-gray-300 text-gray-900 w-24"
            min={1}
            max={10}
          />
        </div>

        {/* H.264 Tune — zerolatency toggle */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            H.264 Zero Latency
            <Tooltip text="Disables B-frames and reduces encoder buffering. Adds ~5% to bitrate but shaves ~0.5s encoding latency. Only applies to transcoded renditions (not copy/passthrough)." />
          </Label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transcoder.h264.tune === 'zerolatency'}
                onChange={(e) =>
                  setTranscoder({
                    ...transcoder,
                    h264: { ...transcoder.h264, tune: e.target.checked ? 'zerolatency' : 'none' },
                  })
                }
                className="h-4 w-4 rounded border-gray-300 text-accent-blue focus:ring-accent-blue"
              />
              <span className="text-sm text-gray-900">Enable zero-latency tuning</span>
            </label>
          </div>
        </div>

        {/* H.264 Preset — encoding speed */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            H.264 Preset
            <Tooltip text="Encoding speed vs compression. Ultrafast = lowest latency + CPU, worst compression. Veryfast = better quality, higher CPU. Only applies to transcoded renditions." />
          </Label>
          <Select
            value={transcoder.h264.preset}
            onValueChange={(v) =>
              setTranscoder({ ...transcoder, h264: { ...transcoder.h264, preset: v as 'ultrafast' | 'superfast' | 'veryfast' } })
            }
          >
            <SelectTrigger className="w-[180px] bg-white border-gray-300 text-gray-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-gray-200 text-gray-900">
              <SelectItem value="ultrafast">Ultrafast (lowest CPU)</SelectItem>
              <SelectItem value="superfast">Superfast</SelectItem>
              <SelectItem value="veryfast">Veryfast (best quality)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Codec selection — H.264 only for now */}
        <div className="space-y-1.5">
          <Label className="text-gray-700 text-xs uppercase tracking-wider">Codecs</Label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked disabled className="h-4 w-4 rounded border-gray-300" />
              <span className="text-sm text-gray-900">H.264</span>
            </label>
            <label className="flex items-center gap-2 opacity-50">
              <input type="checkbox" disabled className="h-4 w-4 rounded border-gray-300" />
              <span className="text-sm text-gray-500">AV1 (coming soon)</span>
            </label>
            <label className="flex items-center gap-2 opacity-50">
              <input type="checkbox" disabled className="h-4 w-4 rounded border-gray-300" />
              <span className="text-sm text-gray-500">VP9 (coming soon)</span>
            </label>
          </div>
        </div>
      </Section>

      {/* ================================================================
          PLAYER DEFAULTS SECTION
          Controls how the viewer's hls.js player behaves during live playback
          ================================================================ */}
      <Section title="Player Defaults">
        {/* Live sync duration count */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Live Sync Duration (segments)
            <Tooltip text="How many segments behind the live edge the player targets. Lower = closer to real-time, but higher rebuffer risk. 2 is recommended for low latency." />
          </Label>
          <Input
            type="number"
            value={player.liveSyncDurationCount}
            onChange={(e) => setPlayer({ ...player, liveSyncDurationCount: parseInt(e.target.value) || 2 })}
            className="bg-white border-gray-300 text-gray-900 w-24"
            min={1}
            max={10}
          />
        </div>

        {/* Live max latency duration count */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Max Latency Duration (segments)
            <Tooltip text="Maximum segments behind the live edge before the player forces a catch-up jump. Set to 2× the Live Sync Duration for stability." />
          </Label>
          <Input
            type="number"
            value={player.liveMaxLatencyDurationCount}
            onChange={(e) => setPlayer({ ...player, liveMaxLatencyDurationCount: parseInt(e.target.value) || 4 })}
            className="bg-white border-gray-300 text-gray-900 w-24"
            min={2}
            max={20}
          />
        </div>

        {/* Back buffer length */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Back Buffer Length (seconds)
            <Tooltip text="Seconds of played content to keep in the browser buffer. 0 = discard immediately (saves memory). -1 = keep all (unlimited rewind). Positive values (e.g., 30) keep that many seconds of rewind buffer." />
          </Label>
          <Input
            type="number"
            value={player.backBufferLength}
            onChange={(e) => setPlayer({ ...player, backBufferLength: parseInt(e.target.value) ?? 0 })}
            className="bg-white border-gray-300 text-gray-900 w-24"
            min={-1}
          />
          <p className="text-xs text-gray-500">0 = no rewind, -1 = unlimited rewind, or enter seconds</p>
        </div>

        {/* Low latency mode */}
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Low Latency Mode
            <Tooltip text="Enables hls.js low-latency optimizations for aggressive live edge seeking. Beneficial even without full LL-HLS server support." />
          </Label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={player.lowLatencyMode}
              onChange={(e) => setPlayer({ ...player, lowLatencyMode: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-accent-blue focus:ring-accent-blue"
            />
            <span className="text-sm text-gray-900">Enable low-latency mode</span>
          </label>
        </div>
      </Section>

      {/* ================================================================
          CREATOR REGISTRATION SECTION
          Controls whether new creators can self-register
          ================================================================ */}
      <Section title="Creator Registration">
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Registration Mode
            <Tooltip text="Controls whether new creators can sign up. 'Open' allows immediate access after registration. 'Approval' creates the account but requires admin approval before the creator can log in. 'Disabled' blocks all new registrations." />
          </Label>
          <Select
            value={registrationMode}
            onValueChange={(v) => setRegistrationMode(v as 'open' | 'approval' | 'disabled')}
          >
            <SelectTrigger className="w-[280px] bg-white border-gray-300 text-gray-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border-gray-200 text-gray-900">
              <SelectItem value="open">Open (immediate access)</SelectItem>
              <SelectItem value="approval">Approval Required (admin must approve)</SelectItem>
              <SelectItem value="disabled">Disabled (no new registrations)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-gray-500 mt-1">
            {registrationMode === 'open' && 'New creators can register and start streaming immediately.'}
            {registrationMode === 'approval' && 'New creators can register but must be approved before they can log in.'}
            {registrationMode === 'disabled' && 'The registration page will show an error. Only admins can create new creator accounts.'}
          </p>
        </div>
      </Section>

      <Section title="RTMP Play Access" defaultOpen={false}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Shield className="h-4 w-4 text-gray-500" />
            Manage direct RTMP play IP lists on each live event.
          </div>
          <Link href="/admin/events">
            <Button variant="outline" size="sm" className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50">
              Open Events
            </Button>
          </Link>
        </div>
      </Section>

      {/* ================================================================
          UPLOAD SETTINGS SECTION
          Controls the maximum file size for video uploads
          ================================================================ */}
      <Section title="Upload Settings" defaultOpen={false}>
        <div className="space-y-1.5">
          <Label className="text-gray-700">
            Max Upload Size (GB)
            <Tooltip text="Maximum file size for video uploads. Applies to both creator and admin uploads." />
          </Label>
          <Input
            type="number"
            value={maxUploadSizeGb}
            onChange={(e) => setMaxUploadSizeGb(parseFloat(e.target.value) || 0.1)}
            className="bg-white border-gray-300 text-gray-900 w-32"
            min={0.1}
            max={50}
            step={0.1}
          />
          <p className="text-xs text-gray-500">
            Range: 0.1 GB (100 MB) to 50 GB. Current: {maxUploadSizeGb.toFixed(1)} GB ({Math.round(maxUploadSizeGb * BYTES_PER_GB).toLocaleString()} bytes)
          </p>
        </div>
      </Section>

      {/* ================================================================
          VOD CODEC SELECTION SECTION
          Controls which video codecs are enabled for VOD transcoding
          ================================================================ */}
      <Section title="VOD Codec Selection" defaultOpen={false}>
        <p className="text-sm text-gray-500 mb-2">
          Select which codecs to use when transcoding uploaded videos. At least one must be enabled.
        </p>
        <div className="space-y-3">
          {ALL_CODEC_NAMES.map((codec) => (
            <label key={codec} className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={enabledCodecs.includes(codec)}
                onCheckedChange={(checked) => handleCodecToggle(codec, checked)}
                // Prevent unchecking if this is the last enabled codec
                disabled={enabledCodecs.length === 1 && enabledCodecs.includes(codec)}
              />
              <span className="text-sm text-gray-900 font-medium">
                {CODEC_LABELS[codec] || codec}
              </span>
              <Tooltip text={CODEC_TOOLTIPS[codec] || ''} />
            </label>
          ))}
        </div>
        {enabledCodecs.length === 1 && (
          <p className="text-xs text-amber-600 mt-2">
            At least one codec must remain enabled. Enable another codec before disabling this one.
          </p>
        )}
      </Section>

      {/* ================================================================
          VOD RENDITION LADDERS SECTION
          Per-codec quality level configuration (only shown for enabled codecs)
          ================================================================ */}
      <Section title="VOD Rendition Ladders" defaultOpen={false}>
        <p className="text-sm text-gray-500 mb-3">
          Configure the quality levels (renditions) for each enabled codec.
          Each rendition defines a resolution and bitrate that the transcoder will produce.
        </p>

        {/* Show a sub-section for each enabled codec */}
        {enabledCodecs.map((codec) => (
          <div key={codec} className="border border-gray-100 rounded-lg p-4 space-y-3">
            {/* Codec header with preset button */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">
                {CODEC_LABELS[codec] || codec} Renditions
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => resetRenditionsToDefault(codec)}
                className="text-xs"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Default (1080p + 720p + 480p)
              </Button>
            </div>

            {/* Rendition table — one row per quality level */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="pb-2 pr-2">Label</th>
                    <th className="pb-2 pr-2">Width</th>
                    <th className="pb-2 pr-2">Height</th>
                    <th className="pb-2 pr-2">Video Bitrate</th>
                    <th className="pb-2 pr-2">Audio Bitrate</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {(vodRenditions[codec] || []).map((rendition, idx) => (
                    <tr key={idx} className="border-b border-gray-50">
                      {/* Label — e.g., "1080p", "720p" */}
                      <td className="py-1.5 pr-2">
                        <Input
                          value={rendition.label}
                          onChange={(e) => updateRendition(codec, idx, 'label', e.target.value)}
                          className="bg-white border-gray-300 text-gray-900 h-8 text-xs w-20"
                          placeholder="1080p"
                        />
                      </td>
                      {/* Width — output video width in pixels */}
                      <td className="py-1.5 pr-2">
                        <Input
                          type="number"
                          value={rendition.width}
                          onChange={(e) => updateRendition(codec, idx, 'width', parseInt(e.target.value) || 0)}
                          className="bg-white border-gray-300 text-gray-900 h-8 text-xs w-20"
                          min={1}
                        />
                      </td>
                      {/* Height — output video height in pixels */}
                      <td className="py-1.5 pr-2">
                        <Input
                          type="number"
                          value={rendition.height}
                          onChange={(e) => updateRendition(codec, idx, 'height', parseInt(e.target.value) || 0)}
                          className="bg-white border-gray-300 text-gray-900 h-8 text-xs w-20"
                          min={1}
                        />
                      </td>
                      {/* Video Bitrate — FFmpeg string like '5000k' */}
                      <td className="py-1.5 pr-2">
                        <Input
                          value={rendition.videoBitrate}
                          onChange={(e) => updateRendition(codec, idx, 'videoBitrate', e.target.value)}
                          className="bg-white border-gray-300 text-gray-900 h-8 text-xs w-20"
                          placeholder="5000k"
                        />
                      </td>
                      {/* Audio Bitrate — FFmpeg string like '128k' */}
                      <td className="py-1.5 pr-2">
                        <Input
                          value={rendition.audioBitrate}
                          onChange={(e) => updateRendition(codec, idx, 'audioBitrate', e.target.value)}
                          className="bg-white border-gray-300 text-gray-900 h-8 text-xs w-20"
                          placeholder="128k"
                        />
                      </td>
                      {/* Remove button — disabled if only one rendition remains */}
                      <td className="py-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeRendition(codec, idx)}
                          disabled={(vodRenditions[codec] || []).length <= 1}
                          className="h-8 w-8 p-0 text-red-400 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add rendition button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addRendition(codec)}
              className="text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Rendition
            </Button>
          </div>
        ))}

        {enabledCodecs.length === 0 && (
          <p className="text-sm text-gray-400 italic">
            No codecs enabled. Enable at least one codec in the &quot;VOD Codec Selection&quot; section above.
          </p>
        )}
      </Section>

      {/* ================================================================
          STATUS MESSAGES + SAVE BUTTON
          ================================================================ */}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Save Settings
      </Button>
    </div>
  );
}
