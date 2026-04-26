'use client';

// =========================================================================
// 2FA Setup Wizard Page (/admin/setup-2fa)
// =========================================================================
// Shown to new admin users who haven't set up two-factor authentication yet.
// The middleware redirects here when session.twoFactorVerified is false.
//
// 4-step wizard:
//   1. "scan"     — Display QR code for authenticator app (+ manual secret)
//   2. "verify"   — Enter 6-digit code to confirm authenticator is working
//   3. "recovery" — Display 10 one-time recovery codes (copy/download)
//   4. "done"     — Confirm codes are saved, redirect to admin dashboard
//
// Recovery codes are shown ONCE and never again. The user must save them
// before they can proceed.
// =========================================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeCanvas } from 'qrcode.react';
import { Loader2, Shield, Copy, Download, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** The steps in the 2FA setup wizard */
type SetupStep = 'scan' | 'verify' | 'recovery' | 'done';

export default function Setup2FAPage() {
  const [step, setStep] = useState<SetupStep>('scan');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  // Step 1: Call the API to generate a new TOTP secret and get the QR code URI
  const startSetup = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to start 2FA setup');
        return;
      }

      setOtpauthUri(data.data.otpauthUri);
      setManualSecret(data.data.secret);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-start the setup process when the page loads.
  // This triggers the API call to generate the TOTP secret.
  if (!otpauthUri && !loading && !error) {
    startSetup();
  }

  // Step 2: Verify the user's TOTP code to confirm their authenticator
  // app is correctly configured. On success, generates recovery codes.
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode || verifyCode.length !== 6) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/2fa/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid verification code');
        return;
      }

      setRecoveryCodes(data.data.recoveryCodes);
      setStep('recovery');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /** Copy all recovery codes to clipboard (separated by newlines) */
  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /** Download recovery codes as a .txt file */
  const downloadRecoveryCodes = () => {
    const content = `StreamGate Recovery Codes\n${'='.repeat(30)}\n\nStore these codes in a safe place.\nEach code can only be used once.\n\n${recoveryCodes.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'streamgate-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Complete setup and redirect to the admin dashboard */
  const finishSetup = () => {
    router.push('/admin');
    router.refresh();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md bg-white border-gray-200 text-gray-900">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 h-12 w-12 rounded-xl bg-accent-blue/10 flex items-center justify-center">
            <Shield className="h-6 w-6 text-accent-blue" />
          </div>
          <CardTitle className="text-gray-900">
            {step === 'scan' && 'Set Up Two-Factor Authentication'}
            {step === 'verify' && 'Verify Your Authenticator'}
            {step === 'recovery' && 'Save Recovery Codes'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Step 1: Scan QR Code */}
          {step === 'scan' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Scan this QR code with your authenticator app (Google Authenticator, Microsoft Authenticator, or any TOTP app).
              </p>

              {otpauthUri ? (
                <>
                  <div className="flex justify-center p-4 bg-white rounded-lg">
                    <QRCodeCanvas value={otpauthUri} size={200} level="M" />
                  </div>

                  <details className="text-sm">
                    <summary className="text-gray-500 cursor-pointer hover:text-gray-700">
                      Can&apos;t scan? Enter key manually
                    </summary>
                    <div className="mt-2 p-2 bg-gray-50 rounded font-mono text-xs break-all text-gray-700">
                      {manualSecret}
                    </div>
                  </details>

                  <Button onClick={() => setStep('verify')} className="w-full">
                    I&apos;ve scanned the code
                  </Button>
                </>
              ) : (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 2: Verify Code */}
          {step === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Enter the 6-digit code shown in your authenticator app.
              </p>
              <Input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-accent-blue text-center text-2xl tracking-widest"
                autoFocus
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || verifyCode.length !== 6}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Continue'
                )}
              </Button>
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => { setStep('scan'); setError(''); }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Back to QR code
                </button>
              </div>
            </form>
          )}

          {/* Step 3: Recovery Codes */}
          {step === 'recovery' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium">
                  Save these recovery codes in a safe place. Each code can only be used once.
                  You won&apos;t be able to see them again.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-lg font-mono text-sm">
                {recoveryCodes.map((code, i) => (
                  <div key={i} className="text-gray-700">{code}</div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyRecoveryCodes}
                  className="flex-1"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadRecoveryCodes}
                  className="flex-1"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={savedConfirm}
                  onChange={(e) => setSavedConfirm(e.target.checked)}
                  className="rounded border-gray-300"
                />
                I have saved my recovery codes
              </label>

              <Button onClick={finishSetup} className="w-full" disabled={!savedConfirm}>
                Complete Setup
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
