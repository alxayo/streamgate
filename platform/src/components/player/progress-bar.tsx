'use client';

import { useCallback } from 'react';

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  buffered: number;
  isLive: boolean;
  onSeek: (time: number) => void;
}

export function ProgressBar({
  currentTime,
  duration,
  buffered,
  isLive,
  onSeek,
}: ProgressBarProps) {
  if (isLive) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      onSeek(percentage * duration);
    },
    [duration, onSeek],
  );

  return (
    <div
      className="relative w-full h-1 bg-white/20 rounded-full cursor-pointer group hover:h-2 transition-all"
      onClick={handleClick}
      role="slider"
      aria-label="Video progress"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
    >
      {/* Buffered */}
      <div
        className="absolute inset-y-0 left-0 bg-white/30 rounded-full"
        style={{ width: `${bufferedProgress}%` }}
      />
      {/* Progress */}
      <div
        className="absolute inset-y-0 left-0 bg-accent-blue rounded-full"
        style={{ width: `${progress}%` }}
      />
      {/* Thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-accent-blue rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow"
        style={{ left: `${progress}%`, marginLeft: '-6px' }}
      />
    </div>
  );
}
