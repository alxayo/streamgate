'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Loader2, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ErrorMessage } from './error-message';
import { validateToken } from '@/lib/api-client';
import type { TokenValidationResponse } from '@streaming/shared';

interface TokenEntryProps {
  appName: string;
  initialCode?: string;
  onSuccess: (data: TokenValidationResponse, code: string) => void;
}

type SubmitState = 'idle' | 'loading' | 'success';

export function TokenEntry({ appName, initialCode, onSuccess }: TokenEntryProps) {
  const [code, setCode] = useState(initialCode || '');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const autoSubmitted = useRef(false);

  const submitCode = useCallback(
    async (codeToSubmit: string) => {
      const trimmedCode = codeToSubmit.trim();

      if (!trimmedCode) return;

      // Client-side alphanumeric check
      if (!/^[A-Za-z0-9]+$/.test(trimmedCode)) {
        setError({ status: 400, message: 'Invalid code. Please check your ticket and try again.' });
        return;
      }

      setError(null);
      setSubmitState('loading');

      try {
        const data = await validateToken(trimmedCode);
        setSubmitState('success');

        // Brief success animation before transitioning
        setTimeout(() => {
          onSuccess(data, trimmedCode);
        }, 600);
      } catch (err: unknown) {
        setSubmitState('idle');
        const fetchError = err as { status?: number; body?: { error?: string; inUse?: boolean } };
        const status = fetchError.status ?? 500;
        const message =
          fetchError.body?.error ??
          'Something went wrong. Please try again.';
        setError({ status, message });
      }
    },
    [onSuccess],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submitCode(code);
    },
    [code, submitCode],
  );

  // Auto-submit when initialCode is provided (e.g., from QR code URL)
  useEffect(() => {
    if (initialCode && !autoSubmitted.current) {
      autoSubmitted.current = true;
      submitCode(initialCode);
    }
  }, [initialCode, submitCode]);

  return (
    <Card className="w-full max-w-md mx-auto border-gray-700/50 bg-charcoal/90 backdrop-blur-sm">
      <CardHeader className="text-center space-y-2">
        <div className="mx-auto mb-2">
          <div className="h-12 w-12 rounded-xl bg-accent-blue/20 flex items-center justify-center">
            <ArrowRight className="h-6 w-6 text-accent-blue" />
          </div>
        </div>
        <CardTitle className="text-2xl">{appName}</CardTitle>
        <CardDescription>Enter your access code to start watching</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Enter your access code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              className={`font-mono text-lg tracking-wider text-center h-12 ${
                error ? 'border-live-red focus-visible:ring-live-red' : ''
              }`}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={submitState !== 'idle'}
            />
            <p className="text-xs text-gray-500 text-center">
              Enter the code from your ticket
            </p>
          </div>

          <ErrorMessage error={error} />

          <Button
            type="submit"
            className="w-full h-11"
            disabled={!code.trim() || submitState !== 'idle'}
          >
            {submitState === 'loading' ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying...
              </motion.div>
            ) : submitState === 'success' ? (
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-2"
              >
                <Check className="h-4 w-4" />
                Access Granted
              </motion.div>
            ) : (
              'Watch Now'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
