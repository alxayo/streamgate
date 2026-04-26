'use client';

// =========================================================================
// Admin Login Form Component
// =========================================================================
// A multi-step login form that handles the complete authentication flow:
//
// Step 1: "credentials" — Email + password entry
//   → On success: routes to step 2 (2FA) or redirects to admin/setup-2fa
//   → On legacy mode: redirects directly to admin dashboard
//
// Step 2: "2fa" — 6-digit TOTP code from authenticator app
//   → On success: redirects to admin dashboard
//   → Lost authenticator? Switch to recovery code step
//
// Step 3: "recovery" — One-time recovery code (format: XXXXX-XXXXX)
//   → On success: redirects to admin dashboard (warns if codes running low)
//
// Step 4: "emergency" — Emergency recovery password (bypasses 2FA entirely)
//   → On success: redirects to admin dashboard as Super Admin
//
// The loginToken (short-lived JWT) is passed between steps 1 and 2/3
// to prove the password was already verified.
// =========================================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, Shield, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** The possible steps in the login flow */
type LoginStep = 'credentials' | '2fa' | 'recovery' | 'emergency';

export function LoginForm() {
  const [step, setStep] = useState<LoginStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [emergencyPassword, setEmergencyPassword] = useState('');
  const [loginToken, setLoginToken] = useState('');  // JWT from step 1, needed for steps 2/3
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');         // Recovery code low-count warning
  const [loading, setLoading] = useState(false);
  const [isLegacyMode, setIsLegacyMode] = useState(false);  // True if no admin users in DB
  const router = useRouter();

  /**
   * Step 1 handler: Submit email + password to the login API.
   * The response determines what happens next:
   *   - legacy mode → redirect to dashboard
   *   - requires2FA → move to TOTP step with loginToken
   *   - requiresSetup2FA → redirect to 2FA setup wizard
   */
  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError('');

    try {
      const body: Record<string, string> = { password };
      if (email) body.email = email;

      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid credentials');
        return;
      }

      if (data.data?.legacy) {
        setIsLegacyMode(true);
        router.push('/admin');
        router.refresh();
        return;
      }

      if (data.data?.requires2FA) {
        setLoginToken(data.data.loginToken);
        setStep('2fa');
        return;
      }

      if (data.data?.requiresSetup2FA) {
        router.push('/admin/setup-2fa');
        router.refresh();
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 2 handler: Submit the 6-digit TOTP code from the authenticator app.
   * Sends the loginToken (from step 1) + code to the verify-2fa endpoint.
   */
  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length !== 6) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginToken, code: totpCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid verification code');
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 3 handler: Submit a one-time recovery code instead of TOTP.
   * Shows a warning if the user is running low on remaining codes.
   */
  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryCode) return;

    setLoading(true);
    setError('');
    setWarning('');

    try {
      const res = await fetch('/api/admin/verify-recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginToken, recoveryCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid recovery code');
        return;
      }

      if (data.data?.warning) {
        setWarning(data.data.warning);
        // Brief delay so user can see warning before redirect
        setTimeout(() => {
          router.push('/admin');
          router.refresh();
        }, 3000);
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 4 handler: Emergency access — bypasses normal auth entirely.
   * Uses the EMERGENCY_RECOVERY_PASSWORD env var. Always audit-logged.
   */
  const handleEmergencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emergencyPassword) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/emergency-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: emergencyPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Invalid credentials');
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /** Reset back to the email/password step (clears all intermediate state) */
  const resetToCredentials = () => {
    setStep('credentials');
    setError('');
    setWarning('');
    setTotpCode('');
    setRecoveryCode('');
    setEmergencyPassword('');
    setLoginToken('');
  };

  return (
    <Card className="w-full max-w-sm bg-white border-gray-200 text-gray-900">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 h-12 w-12 rounded-xl bg-accent-blue/10 flex items-center justify-center">
          {step === '2fa' ? (
            <Shield className="h-6 w-6 text-accent-blue" />
          ) : step === 'recovery' ? (
            <KeyRound className="h-6 w-6 text-accent-blue" />
          ) : (
            <Lock className="h-6 w-6 text-accent-blue" />
          )}
        </div>
        <CardTitle className="text-gray-900">
          {step === 'credentials' && 'Admin Console'}
          {step === '2fa' && 'Two-Factor Authentication'}
          {step === 'recovery' && 'Recovery Code'}
          {step === 'emergency' && 'Emergency Access'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Step 1: Email + Password */}
        {step === 'credentials' && (
          <form onSubmit={handleCredentialSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-700">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-accent-blue"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-700">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-accent-blue"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !password}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
            <div className="text-center">
              <button
                type="button"
                onClick={() => setStep('emergency')}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Emergency access
              </button>
            </div>
          </form>
        )}

        {/* Step 2: TOTP Code */}
        {step === '2fa' && (
          <form onSubmit={handle2FASubmit} className="space-y-4">
            <p className="text-sm text-gray-500 text-center">
              Enter the 6-digit code from your authenticator app.
            </p>
            <Input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-accent-blue text-center text-2xl tracking-widest"
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || totpCode.length !== 6}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify'
              )}
            </Button>
            <div className="flex justify-between">
              <button
                type="button"
                onClick={() => setStep('recovery')}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Use recovery code
              </button>
              <button
                type="button"
                onClick={resetToCredentials}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Back to login
              </button>
            </div>
          </form>
        )}

        {/* Step 3: Recovery Code */}
        {step === 'recovery' && (
          <form onSubmit={handleRecoverySubmit} className="space-y-4">
            <p className="text-sm text-gray-500 text-center">
              Enter one of your recovery codes (e.g., XXXXX-XXXXX).
            </p>
            <Input
              type="text"
              placeholder="XXXXX-XXXXX"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-accent-blue text-center font-mono"
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            {warning && (
              <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">{warning}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !recoveryCode}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Use Recovery Code'
              )}
            </Button>
            <div className="text-center">
              <button
                type="button"
                onClick={resetToCredentials}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Back to login
              </button>
            </div>
          </form>
        )}

        {/* Emergency Access */}
        {step === 'emergency' && (
          <form onSubmit={handleEmergencySubmit} className="space-y-4">
            <p className="text-sm text-gray-500 text-center">
              Enter the emergency recovery password. This access will be logged.
            </p>
            <Input
              type="password"
              placeholder="Emergency recovery password"
              value={emergencyPassword}
              onChange={(e) => setEmergencyPassword(e.target.value)}
              className="bg-gray-50 border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:ring-accent-blue"
              autoFocus
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading || !emergencyPassword}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Emergency Sign In'
              )}
            </Button>
            <div className="text-center">
              <button
                type="button"
                onClick={resetToCredentials}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Back to login
              </button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

