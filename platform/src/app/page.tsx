'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { TokenEntry } from '@/components/viewer/token-entry';
import { PlayerScreen } from '@/components/viewer/player-screen';
import { Toaster } from '@/components/ui/toaster';
import type { TokenValidationResponse } from '@streaming/shared';

function HomeContent() {
  const searchParams = useSearchParams();
  const initialCode = searchParams.get('code') || undefined;

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
        initialCode={initialCode}
        onSuccess={(data, code) => setValidationData({ data, code })}
      />
      <Toaster />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
