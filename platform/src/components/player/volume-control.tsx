'use client';

import { useState, useCallback, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

interface VolumeControlProps {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onMuteToggle: () => void;
}

export function VolumeControl({ volume, muted, onVolumeChange, onMuteToggle }: VolumeControlProps) {
  const [showSlider, setShowSlider] = useState(false);

  // Persist mute state to localStorage (PDR §9.4)
  useEffect(() => {
    const savedMuted = localStorage.getItem('player-muted');
    if (savedMuted === 'true') {
      onMuteToggle();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMuteClick = useCallback(() => {
    onMuteToggle();
    localStorage.setItem('player-muted', muted ? 'false' : 'true');
  }, [muted, onMuteToggle]);

  return (
    <div
      className="flex items-center gap-1 group"
      onMouseEnter={() => setShowSlider(true)}
      onMouseLeave={() => setShowSlider(false)}
    >
      <button
        onClick={handleMuteClick}
        className="flex items-center justify-center h-10 w-10 rounded-full hover:bg-white/10 transition-colors"
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {muted || volume === 0 ? (
          <VolumeX className="h-5 w-5 text-white" />
        ) : (
          <Volume2 className="h-5 w-5 text-white" />
        )}
      </button>
      {showSlider && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-20 h-1 accent-accent-blue cursor-pointer"
          aria-label="Volume"
        />
      )}
    </div>
  );
}
