import fs from 'node:fs';
import path from 'node:path';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Read ADMIN_PASSWORD_HASH directly from .env file to avoid Next.js $ expansion.
 * bcrypt hashes contain $ which Next.js interprets as env var references.
 */
function loadAdminPasswordHash(): string {
  // First check if a file-based hash is configured
  const hashFile = process.env.ADMIN_PASSWORD_HASH_FILE;
  if (hashFile) {
    return fs.readFileSync(hashFile, 'utf-8').trim();
  }

  // Read directly from .env file(s), bypassing dotenv expansion.
  const envPaths = [
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of envPaths) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('ADMIN_PASSWORD_HASH=')) {
          return trimmed.slice('ADMIN_PASSWORD_HASH='.length).trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      // try the next .env path
    }
  }

  const directHash = process.env.ADMIN_PASSWORD_HASH;
  if (directHash) {
    return directHash.trim().replace(/^["']|["']$/g, '');
  }

  throw new Error('ADMIN_PASSWORD_HASH not found in environment variables or .env files');
}

let _adminHash: string | null = null;

export const env = {
  get ADMIN_PASSWORD_HASH() {
    if (!_adminHash) _adminHash = loadAdminPasswordHash();
    return _adminHash;
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

/**
 * Derive the public HLS server base URL from the incoming request.
 * Replaces the port in the request's Host with the HLS server port so
 * LAN/remote clients get a reachable URL instead of hardcoded localhost.
 */
export function getHlsBaseUrl(requestHost: string | null): string {
  const configured = env.HLS_SERVER_BASE_URL;
  if (!requestHost) return configured;

  try {
    const hlsUrl = new URL(configured);
    // Extract hostname from request Host header (strip port if present)
    const reqHostname = requestHost.replace(/:\d+$/, '');
    hlsUrl.hostname = reqHostname;
    // Remove trailing slash
    return hlsUrl.origin;
  } catch {
    return configured;
  }
}
