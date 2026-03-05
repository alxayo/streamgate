'use client';

import { useRef, useEffect, useCallback } from 'react';
import { sendHeartbeat } from '@/lib/api-client';
import { HEARTBEAT_INTERVAL_MS } from '@streaming/shared';

/**
 * Send heartbeat every 30 seconds to keep active session alive (PDR §5.3).
 */
export function useSessionHeartbeat(
  getToken: () => string,
  onSessionExpired: () => void,
  onSessionConflict: () => void,
) {
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const sendHeartbeatFn = useCallback(async () => {
    try {
      await sendHeartbeat(getToken());
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 404) {
        onSessionExpired();
      } else if (status === 409) {
        onSessionConflict();
      }
      // Other errors (network): continue, session will time out naturally
    }
  }, [getToken, onSessionExpired, onSessionConflict]);

  useEffect(() => {
    timerRef.current = setInterval(sendHeartbeatFn, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sendHeartbeatFn]);
}
