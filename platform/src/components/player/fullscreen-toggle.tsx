'use client';

import { useCallback, useState, useEffect } from 'react';
import { Maximize, Minimize } from 'lucide-react';

interface FullscreenToggleProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function FullscreenToggle({ containerRef }: FullscreenToggleProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, [containerRef]);

  return (
    <button
      onClick={toggleFullscreen}
      className="flex items-center justify-center h-10 w-10 rounded-full hover:bg-white/10 transition-colors"
      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
    >
      {isFullscreen ? (
        <Minimize className="h-5 w-5 text-white" />
      ) : (
        <Maximize className="h-5 w-5 text-white" />
      )}
    </button>
  );
}
