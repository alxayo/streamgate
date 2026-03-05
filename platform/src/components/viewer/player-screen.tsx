'use client';

import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import { VideoPlayer } from '@/components/player/video-player';
import { LiveBadge, RecordingBadge } from '@/components/player/live-badge';
import { PreEventScreen } from './pre-event-screen';
import { AccessEnded } from './access-ended';
import { useJwtRefresh } from '@/hooks/use-jwt-refresh';
import { useSessionHeartbeat } from '@/hooks/use-session-heartbeat';
import { useSessionRelease } from '@/hooks/use-session-release';
import { useEventStatus } from '@/hooks/use-event-status';
import { useExpiryCountdown } from '@/hooks/use-expiry-countdown';
import { useToast } from '@/hooks/use-toast';
import type { TokenValidationResponse } from '@streaming/shared';

interface PlayerScreenProps {
  data: TokenValidationResponse;
  code: string;
  onBack: () => void;
}

export function PlayerScreen({ data, code, onBack }: PlayerScreenProps) {
  const [endedMessage, setEndedMessage] = useState<string | null>(null);
  const { toast } = useToast();

  // JWT auto-refresh
  const { getToken } = useJwtRefresh(
    data.playbackToken,
    data.tokenExpiresIn,
    () => setEndedMessage('Your access has ended'),
  );

  // Session heartbeat
  useSessionHeartbeat(
    getToken,
    () => setEndedMessage('Your session has expired due to inactivity. Please re-enter your access code.'),
    () => setEndedMessage('Your session has been started on another device.'),
  );

  // Session release on page close
  useSessionRelease(getToken);

  // Event status polling (for pre-event screen)
  const eventStatus = useEventStatus(
    data.streamPath.split('/')[2], // Extract eventId from path
    code,
    !data.event.isLive,
  );

  // Expiry countdown
  const { minutesRemaining, showWarning, isExpired } = useExpiryCountdown(data.expiresAt);

  // Show expiry warning toast
  useEffect(() => {
    if (showWarning && minutesRemaining !== null) {
      toast({
        title: 'Access expiring soon',
        description: `Your access expires in ${minutesRemaining} minutes`,
        variant: 'default',
      });
    }
  }, [showWarning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle expiry
  useEffect(() => {
    if (isExpired) {
      // 60-second grace period (PDR §11)
      const timeout = setTimeout(() => {
        setEndedMessage('Your access has ended');
      }, 60_000);
      return () => clearTimeout(timeout);
    }
  }, [isExpired]);

  // Handle stream errors
  const handleStreamError = useCallback(
    (errorType: 'auth' | 'network') => {
      if (errorType === 'auth') {
        setEndedMessage('Your access has been revoked');
      }
    },
    [],
  );

  // Determine what to show
  const isLive = data.event.isLive || eventStatus === 'live';
  const isPreEvent = !data.event.isLive && eventStatus === 'not-started';
  const streamUrl = `${data.playbackBaseUrl}${data.streamPath}`;

  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-cinema-black/90 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-white font-semibold truncate">{data.event.title}</h1>
          {isLive && <LiveBadge />}
          {!isLive && !isPreEvent && <RecordingBadge />}
        </div>
        <div className="flex items-center gap-2">
          {minutesRemaining !== null && minutesRemaining <= 360 && minutesRemaining > 0 && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="h-3 w-3" />
              <span>Access expires in {minutesRemaining}m</span>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 relative">
        {isPreEvent ? (
          <PreEventScreen
            title={data.event.title}
            description={data.event.description}
            startsAt={data.event.startsAt}
            posterUrl={data.event.posterUrl}
          />
        ) : (
          <VideoPlayer
            streamUrl={streamUrl}
            isLive={isLive}
            getToken={getToken}
            onStreamError={handleStreamError}
          />
        )}

        {/* Access ended overlay */}
        {endedMessage && <AccessEnded message={endedMessage} onBack={onBack} />}
      </div>
    </div>
  );
}
