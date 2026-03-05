'use client';

/**
 * Format seconds to MM:SS or HH:MM:SS display (PDR §9.6).
 */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface TimeDisplayProps {
  currentTime: number;
  duration: number;
  isLive: boolean;
}

export function TimeDisplay({ currentTime, duration, isLive }: TimeDisplayProps) {
  if (isLive) {
    return <span className="font-mono text-sm text-gray-300 tabular-nums">LIVE</span>;
  }

  return (
    <span className="font-mono text-sm text-gray-300 tabular-nums">
      {formatTime(currentTime)} / {formatTime(duration)}
    </span>
  );
}
