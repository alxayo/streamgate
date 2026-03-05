'use client';

import { useState } from 'react';
import { TokenEntry } from '@/components/viewer/token-entry';
import { PlayerScreen } from '@/components/viewer/player-screen';
import { Toaster } from '@/components/ui/toaster';
import type { TokenValidationResponse } from '@streaming/shared';

export default function Home() {
  const [validationData, setValidationData] = useState<{
    data: TokenValidationResponse;
    code: string;
  } | null>(null);

  if (validationData) {
    return (
      <>
        <PlayerScreen
          data={validationData.data}
          code={validationData.code}
          onBack={() => setValidationData(null)}
        />
        <Toaster />
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-cinema-black p-4">
      <TokenEntry
        appName={process.env.NEXT_PUBLIC_APP_NAME || 'StreamGate'}
        onSuccess={(data, code) => setValidationData({ data, code })}
      />
      <Toaster />
    </main>
  );
}
