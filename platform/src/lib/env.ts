function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get ADMIN_PASSWORD_HASH() {
    return requireEnv('ADMIN_PASSWORD_HASH');
  },
  get PLAYBACK_SIGNING_SECRET() {
    return requireEnv('PLAYBACK_SIGNING_SECRET');
  },
  get INTERNAL_API_KEY() {
    return requireEnv('INTERNAL_API_KEY');
  },
  get DATABASE_URL() {
    return requireEnv('DATABASE_URL');
  },
  get HLS_SERVER_BASE_URL() {
    return requireEnv('HLS_SERVER_BASE_URL');
  },
  APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'StreamGate',
  SESSION_TIMEOUT_SECONDS: parseInt(process.env.SESSION_TIMEOUT_SECONDS || '60', 10),
} as const;
