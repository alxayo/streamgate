'use client';

import { useState, useEffect, useCallback } from 'react';
import { getEventStatus } from '@/lib/api-client';
import { EVENT_STATUS_POLL_INTERVAL_MS } from '@streaming/shared';
import type { EventStatus } from '@streaming/shared';

/**
 * Poll event status for pre-event screen (PDR §7.3).
 */
export function useEventStatus(
  eventId: string,
  code: string,
  enabled: boolean,
) {
  const [status, setStatus] = useState<EventStatus>('not-started');

  const poll = useCallback(async () => {
    try {
      const data = await getEventStatus(eventId, code);
      setStatus(data.status);
    } catch {
      // Ignore errors — continue polling
    }
  }, [eventId, code]);

  useEffect(() => {
    if (!enabled) return;

    poll();
    const interval = setInterval(poll, EVENT_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, poll]);

  return status;
}
