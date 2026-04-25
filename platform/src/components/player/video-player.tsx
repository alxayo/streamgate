'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import Hls from 'hls.js';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayPauseButton } from './play-pause-button';
import { VolumeControl } from './volume-control';
import { ProgressBar } from './progress-bar';
import { TimeDisplay } from './time-display';
import { FullscreenToggle } from './fullscreen-toggle';
import { QualitySelector } from './quality-selector';
import { LoadingOverlay } from './loading-overlay';

interface VideoPlayerProps {
  streamUrl: string;
  isLive: boolean;
  getToken: () => string;
  onStreamError?: (errorType: 'auth' | 'network') => void;
}

interface QualityLevel {
  index: number;
  height: number;
  label: string;
}

/**
 * Check if the browser supports native HLS playback (old iOS Safari fallback).
 * Only used when MSE / hls.js is unavailable.
 */
function supportsNativeHls(): boolean {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

/** Webkit-safe requestFullscreen for Safari < 16.4. */
function requestFullscreen(el: HTMLElement): void {
  if (el.requestFullscreen) {
    el.requestFullscreen();
  } else if ((el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen) {
    (el as unknown as { webkitRequestFullscreen: () => void }).webkitRequestFullscreen();
  }
}

export function VideoPlayer({ streamUrl, isLive, getToken, onStreamError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [autoQuality, setAutoQuality] = useState(true);
  const fatalErrorCount = useRef(0);

  // Initialize player
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Prefer hls.js (works on Chrome, Firefox, and Safari with MSE — macOS 11+, iOS 15+)
    if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup: (xhr) => {
          xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
        },
        enableWorker: true,
        lowLatencyMode: isLive,
        ...(isLive && { liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6 }),
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const levels = data.levels.map((level, i) => ({
          index: i,
          height: level.height,
          label: `${level.height}p`,
        }));
        setQualityLevels(levels);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentQuality(data.level);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.response?.code === 403) {
            hls.destroy();
            onStreamError?.('auth');
          } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            fatalErrorCount.current++;
            if (fatalErrorCount.current >= 3) {
              hls.destroy();
              onStreamError?.('network');
            } else {
              hls.startLoad();
            }
          } else {
            hls.destroy();
            onStreamError?.('network');
          }
        }
      });

      hlsRef.current = hls;

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    // Fallback: native HLS for old iOS Safari (< iOS 15) where MSE is unavailable
    if (supportsNativeHls()) {
      const token = getToken();
      const url = new URL(streamUrl, window.location.origin);
      url.searchParams.set('__token', token);
      video.src = url.toString();
      video.play().catch(() => {});

      const onError = () => onStreamError?.('network');
      video.addEventListener('error', onError);
      return () => video.removeEventListener('error', onError);
    }

    console.error('HLS is not supported in this browser');
  }, [streamUrl, isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onDurationChange = () => setDuration(video.duration);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
    };
  }, []);

  // Keyboard shortcuts (PDR §13.4)
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;
      // Don't capture if user is typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          break;
        case 'f':
        case 'F':
          if (containerRef.current) requestFullscreen(containerRef.current);
          break;
        case 'm':
        case 'M':
          setMuted((prev) => {
            video.muted = !prev;
            return !prev;
          });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          setVolume(video.volume);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          setVolume(video.volume);
          break;
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, []);

  // Auto-hide controls
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.paused ? video.play() : video.pause();
  }, []);

  const handleVolumeChange = useCallback((newVolume: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVolume;
    setVolume(newVolume);
    if (newVolume > 0) {
      video.muted = false;
      setMuted(false);
    }
  }, []);

  const handleMuteToggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const handleSeek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
  }, []);

  const handleQualityChange = useCallback(
    (level: number) => {
      const hls = hlsRef.current;
      if (!hls) return;
      if (level === -1) {
        hls.currentLevel = -1;
        setAutoQuality(true);
      } else {
        hls.currentLevel = level;
        setAutoQuality(false);
      }
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black group"
      onMouseMove={showControlsTemporarily}
      onClick={togglePlayPause}
      onDoubleClick={() => { if (containerRef.current) requestFullscreen(containerRef.current); }}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        autoPlay
      />

      {/* Loading overlay */}
      {isBuffering && <LoadingOverlay />}

      {/* Controls overlay */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-20 pb-2 px-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div className="mb-2">
              <ProgressBar
                currentTime={currentTime}
                duration={duration}
                buffered={buffered}
                isLive={isLive}
                onSeek={handleSeek}
              />
            </div>

            {/* Controls row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <PlayPauseButton isPlaying={isPlaying} onClick={togglePlayPause} />
                <VolumeControl
                  volume={volume}
                  muted={muted}
                  onVolumeChange={handleVolumeChange}
                  onMuteToggle={handleMuteToggle}
                />
                <TimeDisplay currentTime={currentTime} duration={duration} isLive={isLive} />
              </div>
              <div className="flex items-center gap-1">
                <QualitySelector
                  levels={qualityLevels}
                  currentLevel={currentQuality}
                  autoLevel={autoQuality}
                  onLevelChange={handleQualityChange}
                />
                <FullscreenToggle containerRef={containerRef} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
