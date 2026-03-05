'use client';

import { Loader2 } from 'lucide-react';

export function LoadingOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
      <Loader2 className="h-12 w-12 text-white animate-spin" />
    </div>
  );
}
