'use client';

import { useState, useEffect } from 'react';
import { EXPIRY_WARNING_MINUTES } from '@streaming/shared';

/**
 * Track time-to-expiry and trigger warnings (PDR §7.2, §11).
 */
export function useExpiryCountdown(expiresAt: string) {
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const expiryTime = new Date(expiresAt).getTime();

    const update = () => {
      const remaining = Math.max(0, (expiryTime - Date.now()) / 60000);
      setMinutesRemaining(Math.ceil(remaining));

      if (remaining <= EXPIRY_WARNING_MINUTES && remaining > 0) {
        setShowWarning(true);
      }

      if (remaining <= 0) {
        setIsExpired(true);
      }
    };

    update();
    const interval = setInterval(update, 10_000); // Check every 10s
    return () => clearInterval(interval);
  }, [expiresAt]);

  return { minutesRemaining, showWarning, isExpired };
}
