// =========================================================================
// Environment Variable Loader
// =========================================================================
// This module centralizes all environment variable access for the platform app.
// It handles two tricky problems:
//   1. bcrypt hashes contain "$" characters which Next.js dotenv interprets
//      as variable references (e.g., $2b gets replaced). We read these directly
//      from the .env file instead of using process.env.
//   2. Some variables are optional (for gradual migration from legacy to
//      multi-user auth). We provide null/undefined instead of throwing.
// =========================================================================

import fs from 'node:fs';
import path from 'node:path';

/**
 * Reads an environment variable, throws if missing.
 * Use this for variables that the app cannot start without.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Reads an optional environment variable.
 * Returns undefined (not empty string) if not set.
 */
function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

/**
 * Read a bcrypt hash from env, handling the $ expansion issue.
 * bcrypt hashes contain $ which Next.js interprets as env var references.
 */
function loadBcryptHash(envName: string, fileSuffix: string = '_FILE'): string | undefined {
  // Check if a file-based hash is configured
  const hashFile = process.env[`${envName}${fileSuffix}`];
  if (hashFile) {
    try {
      return fs.readFileSync(hashFile, 'utf-8').trim();
    } catch {
      // fall through
    }
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
        if (trimmed.startsWith(`${envName}=`)) {
          return trimmed.slice(`${envName}=`.length).trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      // try the next .env path
    }
  }

  const directHash = process.env[envName];
  if (directHash) {
    return directHash.trim().replace(/^["']|["']$/g, '');
  }

  return undefined;
}

/**
 * Read ADMIN_PASSWORD_HASH directly from .env file to avoid Next.js $ expansion.
 * bcrypt hashes contain $ which Next.js interprets as env var references.
 */
function loadAdminPasswordHash(): string {
  const hash = loadBcryptHash('ADMIN_PASSWORD_HASH');
  if (!hash) {
    throw new Error('ADMIN_PASSWORD_HASH not found in environment variables or .env files');
  }
  return hash;
}

// Cache hashes so we only read from disk once per process lifetime.
// _adminHash: cached legacy ADMIN_PASSWORD_HASH
// _emergencyHash: cached EMERGENCY_RECOVERY_PASSWORD (undefined = not yet loaded)
let _adminHash: string | null = null;
let _emergencyHash: string | null | undefined = undefined;

/**
 * Centralized environment variable access.
 * All env vars are accessed as lazy getters so they're only read when first used.
 */
export const env = {
  /**
   * Legacy single-password admin hash.
   * @deprecated Use multi-user auth instead. Kept only for backward compatibility
   * during migration from the old single-password system.
   */
  get ADMIN_PASSWORD_HASH() {
    if (!_adminHash) _adminHash = loadAdminPasswordHash();
    return _adminHash;
  },
  /**
   * Secret used for two purposes:
   *   1. Encrypting the iron-session admin cookie
   *   2. Deriving the AES-256-GCM key for encrypting TOTP secrets at rest
   * Must be at least 32 characters. Keep this secret safe — changing it
   * will invalidate all existing sessions and make stored TOTP secrets
   * unrecoverable.
   */
  get ADMIN_SESSION_SECRET() {
    return requireEnv('ADMIN_SESSION_SECRET');
  },
  /**
   * bcrypt hash of the emergency recovery password.
   * Optional — if not set, the emergency login endpoint returns 404.
   * This provides a last-resort way to access the admin console when all
   * admin users are locked out of their 2FA. Every use is audit-logged.
   */
  get EMERGENCY_RECOVERY_PASSWORD() {
    if (_emergencyHash === undefined) {
      _emergencyHash = loadBcryptHash('EMERGENCY_RECOVERY_PASSWORD') ?? null;
    }
    return _emergencyHash;
  },
  /**
   * Email for the first Super Admin user, created automatically on first
   * startup when no admin users exist in the database. Optional — if not
   * set, the app starts in legacy single-password mode.
   */
  get INITIAL_ADMIN_EMAIL() {
    return optionalEnv('INITIAL_ADMIN_EMAIL');
  },
  /**
   * Password for the first Super Admin (must be ≥12 characters).
   * Only used together with INITIAL_ADMIN_EMAIL during first startup.
   */
  get INITIAL_ADMIN_PASSWORD() {
    return optionalEnv('INITIAL_ADMIN_PASSWORD');
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
    // Only replace hostname when running on localhost (dev mode with different ports)
    // In production with separate subdomains, return configured URL as-is
    if (reqHostname === 'localhost' || reqHostname === '127.0.0.1') {
      hlsUrl.hostname = reqHostname;
      return hlsUrl.origin;
    }
    return configured;
  } catch {
    return configured;
  }
}
