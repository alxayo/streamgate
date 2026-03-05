'use client';

import { useState } from 'react';
import { TokenEntry } from '@/components/viewer/token-entry';
import type { TokenValidationResponse } from '@streaming/shared';

export default function Home() {
  const [validationData, setValidationData] = useState<{
    data: TokenValidationResponse;
    code: string;
  } | null>(null);

  if (validationData) {
    // Will be replaced with PlayerScreen in P-12
    return (
      <main className="flex min-h-screen items-center justify-center bg-cinema-black">
        <div className="text-center text-white">
          <h1 className="text-2xl font-semibold mb-2">{validationData.data.event.title}</h1>
          <p className="text-gray-400">Player loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cinema-black p-4">
      <TokenEntry
        appName={process.env.NEXT_PUBLIC_APP_NAME || 'StreamGate'}
        onSuccess={(data, code) => setValidationData({ data, code })}
      />
    </main>
  );
}
