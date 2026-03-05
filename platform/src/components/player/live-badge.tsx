'use client';

import { Radio } from 'lucide-react';

export function LiveBadge() {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-live-red px-2 py-1 text-xs font-semibold text-white">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
      </span>
      LIVE
    </div>
  );
}

export function RecordingBadge() {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-accent-blue px-2 py-1 text-xs font-semibold text-white">
      <Radio className="h-3 w-3" />
      Recording
    </div>
  );
}
