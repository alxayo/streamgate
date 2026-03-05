'use client';

import { useRef, useCallback, useEffect } from 'react';
import { refreshPlaybackToken } from '@/lib/api-client';

/**
 * Auto-refresh JWT every 50 minutes (PDR §4.3).
 * Provides a getToken() callback that always returns the current token.
 */
export function useJwtRefresh(
  initialToken: string,
  tokenExpiresIn: number,
  onRefreshFailed: () => void,
) {
  const tokenRef = useRef(initialToken);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const scheduleRefresh = useCallback(
    (expiresIn: number) => {
      // Refresh 10 minutes before expiry (50 min for 60 min tokens)
      const refreshInMs = Math.max((expiresIn - 600) * 1000, 30_000);

      timerRef.current = setTimeout(async () => {
        try {
          const data = await refreshPlaybackToken(tokenRef.current);
          tokenRef.current = data.playbackToken;
          scheduleRefresh(data.tokenExpiresIn);
        } catch {
          onRefreshFailed();
        }
      }, refreshInMs);
    },
    [onRefreshFailed],
  );

  useEffect(() => {
    scheduleRefresh(tokenExpiresIn);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getToken = useCallback(() => tokenRef.current, []);

  return { getToken };
}
