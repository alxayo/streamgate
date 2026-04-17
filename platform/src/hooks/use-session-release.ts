'use client';

import { useEffect, useRef } from 'react';
import { releaseSession } from '@/lib/api-client';

/**
 * Release session on page close / navigation away (PDR §7.2).
 * Uses fetch with keepalive for reliability.
 *
 * Only fires on `beforeunload` (actual page close / navigation).
 * Tab switches and minimizes are intentionally ignored — the server-side
 * session timeout (SESSION_TIMEOUT_SECONDS) handles truly abandoned sessions.
 */
export function useSessionRelease(getToken: () => string) {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    const handleRelease = () => {
      releaseSession(getTokenRef.current());
    };

    window.addEventListener('beforeunload', handleRelease);

    return () => {
      window.removeEventListener('beforeunload', handleRelease);
    };
  }, []);
}
