'use client';

import { useEffect, useRef } from 'react';
import { releaseSession } from '@/lib/api-client';

/**
 * Release session on page close / navigation away (PDR §7.2).
 * Uses fetch with keepalive for reliability.
 */
export function useSessionRelease(getToken: () => string) {
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    const handleRelease = () => {
      releaseSession(getTokenRef.current());
    };

    window.addEventListener('beforeunload', handleRelease);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        handleRelease();
      }
    });

    return () => {
      window.removeEventListener('beforeunload', handleRelease);
      handleRelease();
    };
  }, []);
}
