/** JWT expiry duration in seconds (PDR §4.3: 1-hour expiry) */
export const JWT_EXPIRY_SECONDS = 3600;

/** JWT refresh interval in ms (PDR §4.3: refresh every 50 minutes) */
export const JWT_REFRESH_INTERVAL_MS = 50 * 60 * 1000;

/** Probe JWT expiry (PDR §10.1: 10-second expiry for stream probing) */
export const PROBE_JWT_EXPIRY_SECONDS = 10;

/** Token code length (PDR §5.2: 12-character base62) */
export const TOKEN_CODE_LENGTH = 12;

/** Token code character set (base62: a-z, A-Z, 0-9) */
export const TOKEN_CODE_CHARSET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Rate limit: token validation (PDR §12: 5/min per IP) */
export const RATE_LIMIT_TOKEN_VALIDATION = { maxRequests: 5, windowMs: 60_000 };

/** Rate limit: JWT refresh (PDR §12: 12/hour per token code) */
export const RATE_LIMIT_JWT_REFRESH = { maxRequests: 12, windowMs: 3_600_000 };

/** Rate limit: admin login (PDR §12: 10/min per IP) */
export const RATE_LIMIT_ADMIN_LOGIN = { maxRequests: 10, windowMs: 60_000 };

// =========================================================================
// Multi-User Admin Authentication Constants
// =========================================================================
// These constants configure the multi-user authentication system with TOTP 2FA.
// They're shared between the platform app and any service that needs them.
// =========================================================================

/** Rate limit: emergency login (3 attempts/hour per IP) — very strict because
 *  emergency login bypasses 2FA entirely */
export const RATE_LIMIT_EMERGENCY_LOGIN = { maxRequests: 3, windowMs: 3_600_000 };

/** Rate limit: 2FA verification — allows 5 attempts within the 5-minute
 *  login token window before locking the user out */
export const RATE_LIMIT_2FA_VERIFY = { maxRequests: 5, windowMs: 300_000 };

/** How long the short-lived JWT token lasts between the password step and
 *  the 2FA verification step (5 minutes). After this expires, the user must
 *  re-enter their password. */
export const LOGIN_TOKEN_EXPIRY_SECONDS = 300;

// --- TOTP (Time-based One-Time Password) Configuration ---
// These values must match what authenticator apps expect (RFC 6238).
// Changing these after users have set up 2FA will lock them out!

/** The issuer name shown in authenticator apps (e.g., "StreamGate" in Google Authenticator) */
export const TOTP_ISSUER = 'StreamGate';

/** Hash algorithm for TOTP — SHA1 is the most widely supported by authenticator apps */
export const TOTP_ALGORITHM = 'SHA1';

/** Number of digits in each TOTP code (standard is 6) */
export const TOTP_DIGITS = 6;

/** How often TOTP codes rotate in seconds (standard is 30) */
export const TOTP_PERIOD = 30;

/** Window of tolerance for clock drift — ±1 means we accept codes from the
 *  previous period, current period, and next period (90-second window total) */
export const TOTP_WINDOW = 1;

/** Number of one-time-use recovery codes generated when 2FA is set up.
 *  Each code is 10 hex characters formatted as XXXXX-XXXXX. */
export const RECOVERY_CODE_COUNT = 10;

/** Minimum password length enforced for all admin users */
export const MIN_PASSWORD_LENGTH = 12;

/** Revocation poll interval default (PDR §4.4: 30 seconds) */
export const DEFAULT_REVOCATION_POLL_INTERVAL_MS = 30_000;

/** Stream path prefix template (PDR §4.3: /streams/:eventId/) */
export const STREAM_PATH_PREFIX = '/streams/';

/** Max batch token generation (PDR §8.4: 1-500) */
export const MAX_BATCH_TOKEN_COUNT = 500;

/** Access window bounds in hours (PDR §8.3: 1-168 hours) */
export const ACCESS_WINDOW_MIN_HOURS = 1;
export const ACCESS_WINDOW_MAX_HOURS = 168;

/** Default access window in hours (PDR §5.1: 48 hours) */
export const DEFAULT_ACCESS_WINDOW_HOURS = 48;

/** Admin session cookie expiry (PDR §8.1: 8 hours) */
export const ADMIN_SESSION_EXPIRY_SECONDS = 8 * 3600;

/** CORS preflight cache (PDR §6.4: 24 hours) */
export const CORS_MAX_AGE_SECONDS = 86400;

/** Expiry warning threshold — show toast (PDR §7.2: 15 minutes before) */
export const EXPIRY_WARNING_MINUTES = 15;

/** Expiry grace period (PDR §11: 60-second grace period) */
export const EXPIRY_GRACE_PERIOD_SECONDS = 60;

/** Pre-event status poll interval (PDR §7.3: every 30 seconds) */
export const EVENT_STATUS_POLL_INTERVAL_MS = 30_000;

/** Session heartbeat interval in ms (PDR §5.3: every 30 seconds) */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Default session timeout in seconds (PDR §5.3: 60 seconds) */
export const DEFAULT_SESSION_TIMEOUT_SECONDS = 60;

/** Token code regex (alphanumeric only, PDR §12) */
export const TOKEN_CODE_REGEX = /^[A-Za-z0-9]+$/;

/** JWT algorithm */
export const JWT_ALGORITHM = 'HS256';
