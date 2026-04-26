---
sidebar_position: 7
title: Security
---

# Security

StreamGate implements defense-in-depth security across multiple layers. This document covers all security mechanisms, their rationale, and operational considerations.

## Token Entropy Analysis

Access codes are 12-character base62 strings generated from `crypto.randomBytes()`:

```
Keyspace:  62^12 = 3.22 × 10^21
Entropy:   log₂(62^12) ≈ 71.45 bits
```

### Brute-Force Infeasibility

With the token validation rate limit of **5 requests/minute per IP**:

| Scenario | Time to Exhaust Keyspace |
|----------|--------------------------|
| 1 attacker (5 req/min) | 1.22 × 10¹⁵ years |
| 1,000 distributed IPs | 1.22 × 10¹² years |
| 1,000,000 distributed IPs | 1.22 × 10⁹ years |

Even without rate limiting, the 71-bit entropy makes blind guessing infeasible. The rate limiter adds defense-in-depth.

:::info
For context, Bitcoin mining targets ~72 bits of leading zeros — our token entropy is comparable, and attackers don't get the parallel advantage of hash computation.
:::

## Two-Layer Stream Protection Model

StreamGate uses two independent layers to protect streams:

```
┌────────────────────────────────────────────────┐
│  Layer 1: Platform App (Token Validation)       │
│                                                  │
│  • Access code → database lookup                │
│  • Check: exists, not expired, not revoked,     │
│    event active, no active session              │
│  • Issues JWT if all checks pass                │
│  • Single-device enforcement at this layer      │
│                                                  │
│  Result: JWT playback token                     │
├────────────────────────────────────────────────┤
│  Layer 2: HLS Server (JWT Verification)         │
│                                                  │
│  • HMAC-SHA256 signature verification (~0.01ms) │
│  • Expiry check (1-hour JWTs)                   │
│  • Path prefix scoping                          │
│  • Revocation cache check (eventually consistent)│
│                                                  │
│  Result: Serve or deny stream content           │
└────────────────────────────────────────────────┘
```

**Why two layers?** Layer 1 provides comprehensive validation with database access. Layer 2 provides stateless, ultra-fast validation for the high-frequency stream requests (manifests + segments every few seconds per viewer).

## JWT Security

### Algorithm Choice: HMAC-SHA256

StreamGate uses `HS256` (HMAC-SHA256) rather than RS256 (RSA):

- Both services are operated by the same party → shared secret is acceptable
- HMAC verification is ~50× faster than RSA (~0.01ms vs ~0.5ms)
- Simpler key management (one secret vs key pair rotation)

The signing secret must be at least 32 characters and shared identically between Platform App and HLS Server via the `PLAYBACK_SIGNING_SECRET` environment variable.

### Short-Lived Tokens

JWTs expire after **1 hour** (`JWT_EXPIRY_SECONDS = 3600`). The player refreshes every **50 minutes** (10-minute buffer):

```
t=0min     JWT issued (exp = t+60min)
t=50min    Player calls POST /api/playback/refresh
           New JWT issued (exp = t+110min)
t=60min    Original JWT expires (but player has new one)
```

Benefits:
- Limits window of exposure if a JWT is leaked
- Combined with revocation sync (≤30s), a revoked token's JWT is usable for at most ~30 additional seconds before the HLS server's cache catches up, and at most 60 minutes before it naturally expires

### Path Scoping

Each JWT's `sp` claim restricts which stream paths it can access:

```json
{
  "sp": "/streams/event-abc-123/"
}
```

The HLS server validates `requestPath.startsWith(claims.sp)` on every request. A JWT for event A cannot access event B's streams.

### Refresh Gating

Token refresh is rate-limited (12/hour per token code) and re-validates the token's status:

- Token still exists in database
- Token not revoked
- Token not expired
- Event still active
- Session still valid

This means a revoked token cannot refresh its JWT — the existing JWT simply expires within an hour.

## Revocation Speed

When a token is revoked or an event is deactivated:

| Timeline | What Happens |
|----------|--------------|
| t=0 | Admin action recorded in Platform database |
| t=0s to t=30s | HLS server still serving (stale cache) |
| t≤30s | HLS server polls and updates revocation cache |
| t≤30s+ | New streaming requests are denied |
| t≤60min | Any JWT in the viewer's browser naturally expires |

**Maximum exposure**: 30 seconds of continued streaming after revocation, plus up to 60 minutes if the viewer has a cached JWT that they somehow replay (e.g., by saving the JWT and crafting requests).

:::tip
For immediate emergency revocation, deploy to multiple HLS instances with shorter poll intervals (`REVOCATION_POLL_INTERVAL_MS=5000`) or restart the HLS server to clear its cache entirely.
:::

## Admin Authentication

### Multi-User Accounts

Admin authentication uses a multi-user system with mandatory TOTP two-factor authentication and role-based access control (RBAC).

**User accounts** are stored in the `AdminUser` database table with:
- Username (unique)
- Bcrypt password hash (cost factor 12)
- Encrypted TOTP secret (AES-256-GCM, key derived from `ADMIN_SESSION_SECRET`)
- Role (`super_admin`, `admin`, or `operator`)
- Account status flags (`isActive`, `twoFactorEnabled`, `twoFactorVerified`)

### Authentication Flow

Login is a two-step process to prevent session fixation:

```
Step 1: Username + Password → Login Token (JWT, 5-minute expiry)
Step 2: Login Token + TOTP Code → Full Session (iron-session cookie)
```

1. **Password verification**: User submits username + password. Server verifies bcrypt hash and returns a short-lived JWT (`loginToken`) containing only the user ID. No session is created yet.
2. **TOTP verification**: User submits the login token + 6-digit TOTP code. Server decrypts the stored TOTP secret, validates the code (±1 period tolerance for clock skew), and creates a full session.
3. **Alternative — Recovery code**: Instead of TOTP, user can submit one of their 8 one-time recovery codes (bcrypt-hashed, marked as used on consumption).

### TOTP Two-Factor Authentication

| Setting | Value | Reason |
|---------|-------|--------|
| Algorithm | SHA-1 | Google Authenticator compatibility |
| Period | 30 seconds | RFC 6238 standard |
| Digits | 6 | Standard TOTP length |
| Tolerance | ±1 period | Handles clock skew (accepts previous/next code) |
| Secret storage | AES-256-GCM encrypted in database | Protects against DB breach |
| Recovery codes | 8 codes, 8-char alphanumeric, bcrypt-hashed | One-time use backup |

:::warning TOTP Secret Encryption
TOTP secrets are encrypted at rest using AES-256-GCM with a key derived from `ADMIN_SESSION_SECRET`. If this secret is rotated, all users must re-enroll 2FA. Back up this value securely.
:::

### Role-Based Access Control (RBAC)

Three roles with hierarchical permissions:

| Permission | Super Admin | Admin | Operator |
|-----------|:-----------:|:-----:|:--------:|
| `dashboard:view` | ✅ | ✅ | ✅ |
| `events:view` | ✅ | ✅ | ❌ |
| `events:manage` | ✅ | ✅ | ❌ |
| `tokens:manage` | ✅ | ✅ | ❌ |
| `settings:manage` | ✅ | ✅ | ❌ |
| `users:manage` | ✅ | ❌ | ❌ |
| `audit:view` | ✅ | ❌ | ❌ |

Permission checks are enforced server-side in every API route via `checkPermission()`. The sidebar UI also hides items the user cannot access.

### Session Cookies

After successful two-factor authentication, `iron-session` creates an encrypted HTTP-only cookie:

| Cookie Attribute | Value | Purpose |
|------------------|-------|---------|
| `httpOnly` | `true` | Prevents JavaScript access (XSS protection) |
| `secure` | `true` (in production) | Cookie only sent over HTTPS |
| `sameSite` | `strict` | Prevents CSRF attacks |
| `maxAge` | 28800 (8 hours) | Auto-expire after 8 hours |

Session data contains `userId`, `username`, and `role`. No sensitive data (passwords, TOTP secrets) is stored in the session.

:::warning
The cookie is encrypted with `iron-session`'s seal/unseal mechanism using `ADMIN_SESSION_SECRET`. Never expose this secret. Rotating it invalidates all active sessions.
:::

### Audit Logging

All admin actions are logged to an immutable `AuditLog` table:

| Field | Description |
|-------|-------------|
| `userId` | Actor's user ID |
| `username` | Actor's username (denormalized for query efficiency) |
| `action` | Action type (e.g., `login_success`, `user_created`, `2fa_reset`) |
| `resource` | Target of the action (e.g., affected username or event ID) |
| `ipAddress` | Client IP address |
| `userAgent` | Browser user-agent string |
| `createdAt` | Timestamp |

Audit entries are append-only — they can never be modified or deleted.

### First-Boot Seeding

On first server start, if no `AdminUser` records exist, a default `super_admin` user is created using:
- Username: `admin`
- Password: from `ADMIN_PASSWORD_HASH` environment variable
- 2FA: Not yet enabled (user completes setup on first login)

## Internal API Security

The revocation sync endpoint (`GET /api/revocations`) is protected by a shared API key:

```
Header: X-Internal-Api-Key: <INTERNAL_API_KEY>
```

- Must match the `INTERNAL_API_KEY` environment variable on both services
- Should be a strong random string (≥32 characters)
- Not a JWT — simple header comparison

:::danger
The internal API key provides full read access to revocation data. Treat it with the same sensitivity as the signing secret. Rotate if compromised.
:::

## Rate Limiting

Three independent in-memory sliding-window rate limiters:

### Token Validation Limiter

| Setting | Value |
|---------|-------|
| Endpoint | `POST /api/tokens/validate` |
| Key | Client IP address |
| Limit | 5 requests per 60 seconds |
| Response (429) | `{ "error": "Too many requests. Please try again later." }` |

Prevents brute-force token guessing and credential stuffing.

### JWT Refresh Limiter

| Setting | Value |
|---------|-------|
| Endpoint | `POST /api/playback/refresh` |
| Key | Token code (from JWT `sub` claim) |
| Limit | 12 requests per 3600 seconds (1 hour) |
| Response (429) | `{ "error": "Too many refresh requests" }` |

Prevents abuse of the refresh endpoint. Normal usage is 1 refresh per 50 minutes.

### Admin Login Limiter

| Setting | Value |
|---------|-------|
| Endpoint | `POST /api/admin/login` |
| Key | Client IP address |
| Limit | 5 requests per 15 minutes per username |
| Response (429) | `{ "error": "Too many login attempts" }` |

Prevents admin password brute-forcing. Additional TOTP-specific rate limiting:

### Emergency Login Limiter

| Setting | Value |
|---------|-------|
| Endpoint | `POST /api/admin/emergency-login` |
| Key | Client IP address |
| Limit | 3 requests per 60 minutes |
| Response (429) | `{ "error": "Too many emergency login attempts" }` |

Stricter rate limit for the emergency bypass endpoint (super_admin only).

:::note
Rate limiters are in-memory (`Map`-based) and reset on server restart. In a horizontally scaled deployment, each instance maintains its own rate limit state. Consider using Redis-backed rate limiting for multi-instance deployments.
:::

## Input Sanitization

### Token Code Validation

All token code input is sanitized before processing:

```typescript
function sanitizeTokenCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return null;
  return trimmed;
}
```

- **Type check**: Rejects non-string input
- **Trim**: Removes leading/trailing whitespace
- **Alphanumeric only**: Rejects any non-alphanumeric characters
- Prevents SQL injection, path traversal, and other injection attacks

### Path Traversal Prevention

The HLS server uses `resolveSecurePath()` to prevent directory traversal attacks:

```
Request: /streams/event-1/../../etc/passwd
resolveSecurePath() → null (path escapes root directory)
→ 404 Not Found
```

## HTTPS and HSTS

:::danger Production Requirement
StreamGate **must** be deployed behind HTTPS in production. Without TLS:
- JWTs are transmitted in plaintext headers (can be intercepted)
- Session cookies can be stolen (even with `httpOnly`)
- The `Secure` cookie flag is meaningless without HTTPS
:::

Recommended HSTS configuration for your reverse proxy:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## CORS Policy

The HLS server restricts cross-origin requests to the Platform App's origin:

```typescript
cors({
  origin: config.corsAllowedOrigin,  // e.g., "https://stream.example.com"
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Range'],
  maxAge: 86400,  // 24-hour preflight cache
})
```

This prevents other websites from embedding StreamGate's streams using stolen JWTs.

## Audit Logging

### HLS Server Request Logger

The request logger records all streaming requests with sanitized URLs:

```typescript
// __token query parameter stripped before logging
const sanitizedUrl = url.replace(/[?&]__token=[^&]+/, '');
```

This prevents JWT leakage in log files while maintaining a full audit trail of who accessed what streams.

### Platform App

API routes log:
- Token validation attempts (success/failure with status code)
- Admin login attempts
- Token revocation actions
- Event activation/deactivation changes

## Safari Token Handling

Safari's native HLS implementation cannot set custom HTTP headers. As a fallback:

1. Player appends `?__token=<JWT>` to stream URLs
2. HLS server's JWT middleware checks `req.query.__token` if no `Authorization` header
3. Request logger **strips** `__token` from logged URLs

```typescript
// jwt-auth.ts
if (!token && typeof req.query.__token === 'string') {
  token = req.query.__token;
}
```

:::warning Security Consideration
Passing JWTs in query parameters means they may appear in:
- Browser history
- Server access logs (mitigated by stripping)
- Referrer headers (mitigated by `Referrer-Policy: no-referrer`)

This is accepted as a necessary tradeoff for Safari compatibility, with mitigations in place.
:::

## Single-Device Enforcement

StreamGate enforces **one viewer per token** at any time:

```
Device A validates token "Ab3k..." → ActiveSession created (sid=aaa)
Device B validates token "Ab3k..." → 409 Conflict "in use on another device"

Device A closes player → Session released
Device B validates token "Ab3k..." → Success, new ActiveSession (sid=bbb)
```

The enforcement mechanism:
1. On validation, check for an `ActiveSession` with `lastHeartbeat` within `SESSION_TIMEOUT_SECONDS`
2. If active session exists → 409
3. If session is stale (heartbeat timeout) → clean up and allow
4. JWT contains `sid` claim → session ID tied to the JWT

This prevents token sharing while allowing a viewer to switch devices after closing the player or waiting for the session to time out.
