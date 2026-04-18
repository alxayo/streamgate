'use client';

import { useCallback, useState, useEffect } from 'react';
import { Maximize, Minimize } from 'lucide-react';

interface FullscreenToggleProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ??
    (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement ??
    null
  );
}

function exitFullscreen(): void {
  if (document.exitFullscreen) {
    document.exitFullscreen();
  } else if ((document as unknown as { webkitExitFullscreen?: () => void }).webkitExitFullscreen) {
    (document as unknown as { webkitExitFullscreen: () => void }).webkitExitFullscreen();
  }
}

function requestFullscreen(el: HTMLElement): void {
  if (el.requestFullscreen) {
    el.requestFullscreen();
  } else if ((el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen) {
    (el as unknown as { webkitRequestFullscreen: () => void }).webkitRequestFullscreen();
  }
}

export function FullscreenToggle({ containerRef }: FullscreenToggleProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!getFullscreenElement());
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (getFullscreenElement()) {
      exitFullscreen();
    } else {
      requestFullscreen(containerRef.current);
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
