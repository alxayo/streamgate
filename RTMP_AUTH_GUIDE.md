# RTMP Per-Event Authentication Implementation

## Overview

This document describes the per-event RTMP authentication system integrated into streamgate and rtmp-go. Each streaming event gets a unique RTMP auth token, enabling secure per-event ingest with single-publisher enforcement and audit logging.

## Architecture

### Data Model

**Event Model Extensions:**
- `rtmpStreamKeyHash` (String, unique): Hashed stream key (format: `slug-abc123def456`)
  - Slug derived from event title (lowercase, alphanumeric + hyphens)
  - Hash: SHA256(eventId).substr(0, 12)
  - Example: `tech-talk-2024-a3b2c1d0e9f8`

- `rtmpToken` (String, unique): 24-character base62 RTMP auth token
  - Generated via HMAC-SHA256(eventId + title + "rtmp", PLAYBACK_SIGNING_SECRET)
  - Deterministic and reproducible
  - Expires with the event (rtmpTokenExpiresAt)

- `rtmpTokenExpiresAt` (DateTime): Token expiry timestamp
  - Set to event.endsAt on creation
  - Updated if event duration is extended

**RtmpSession Model (Audit Trail):**
- `id` (String, PK): Unique session ID
- `eventId` (String, FK): Event being streamed
- `rtmpPublisherIp` (String): Publisher IP for audit trail
- `startedAt` (DateTime): When RTMP stream began
- `endedAt` (DateTime, nullable): When stream ended (null = active)

### API Contracts

#### 1. Event Creation
**Endpoint:** `POST /api/creator/events`

Auto-generates RTMP tokens on event creation:
```typescript
{
  // ...event fields...
  rtmpStreamKeyHash: "tech-talk-2024-a3b2c1d0e9f8",
  rtmpToken: "abc123def456ghi789jkl012XY",
  rtmpTokenExpiresAt: "2024-12-31T23:59:59.000Z"
}
```

#### 2. Token Rotation
**Endpoint:** `POST /api/creator/events/:id/actions`

Rotates RTMP token for an existing event:
```json
{
  "action": "rotate-rtmp-token"
}
```

Response:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "rtmpToken": "new_token_24chars",
    "rtmpStreamKeyHash": "tech-talk-2024-a3b2c1d0e9f8",
    "rtmpTokenExpiresAt": "2024-12-31T23:59:59.000Z",
    "message": "RTMP token rotated successfully. Save the new token — it won't be displayed again."
  }
}
```

#### 3. RTMP Auth Webhook
**Endpoint:** `POST /api/rtmp/auth` (Internal)

Called by rtmp-go on every RTMP publish/play request.

**Authentication:** `X-Internal-Api-Key` header (shared internal secret)

**Request Body:**
```json
{
  "streamKeyHash": "tech-talk-2024-a3b2c1d0e9f8",
  "token": "abc123def456ghi789jkl012XY",
  "action": "publish" | "play",
  "publisherIp": "203.0.113.42:54321"
}
```

**Response (200 OK - Authorized):**
```json
{
  "authorized": true,
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventTitle": "Tech Talk 2024",
  "storagePath": "/streams/550e8400-e29b-41d4-a716-446655440000/",
  "rtmpTokenExpiresAt": "2024-12-31T23:59:59.000Z"
}
```

**Response (403 Forbidden - Unauthorized):**
```json
{
  "authorized": false,
  "reason": "token_expired" | "invalid_token" | "stream_key_not_found" | "already_streaming" | "event_deactivated" | "channel_deactivated"
}
```

**Failure Reasons:**
- `invalid_stream_key_hash`: Format doesn't match `slug-hash`
- `invalid_token`: Format doesn't match 24-char base62
- `invalid_action`: Action not "publish" or "play"
- `stream_key_not_found`: Event with this streamKeyHash doesn't exist
- `event_deactivated`: Event isActive = false
- `channel_deactivated`: Event's channel isActive = false (if exists)
- `invalid_token`: Token doesn't match event's rtmpToken
- `token_expired`: Current time > rtmpTokenExpiresAt
- `already_streaming`: Active RtmpSession exists (action = "publish" only)
- `internal_error`: Database write failed

### RTMP PLAY IP Allow-List

Direct RTMP PLAY is controlled per event by StreamGate when rtmp-go calls
`POST /api/rtmp/auth` with `action: "play"`. Publish authorization is unchanged:
publish still uses the event RTMP token and single-publisher session checks.

Each LIVE event can have RTMP PLAY allow-list entries in the admin event detail
page under **RTMP Play Access**. Entries may be single IPs or CIDR ranges. Single
IPs are stored as host CIDRs, for example `203.0.113.10/32` or `2001:db8::1/128`.
The **Add my current IP** action stores the admin browser IP as seen by StreamGate
through `X-Forwarded-For` / `X-Real-IP`.

Internal Azure clients are controlled by deployment configuration, not the event
UI. `RTMP_INTERNAL_PLAY_ALLOWED_CIDRS` is a comma-separated list of trusted
private ranges that may RTMP PLAY without per-event entries. The Azure Bicep
default is `10.0.0.0/16`, matching the current rtmp-go VNet range.

Rollout is controlled by `RTMP_PLAY_IP_ALLOWLIST_MODE`:

| Mode | Behavior |
|------|----------|
| `off` | Skip RTMP PLAY IP policy entirely. Valid RTMP token auth still applies. |
| `audit` | Evaluate internal CIDRs and per-event entries, log `would_allow` / `would_deny`, but allow otherwise valid authenticated RTMP PLAY. Recommended first Azure rollout. |
| `enforce` | Allow internal CIDR matches and per-event entry matches; deny other external RTMP PLAY clients with `ip_not_allowed`. |

Before switching Azure to `enforce`, test RTMP PLAY from an external IP and an
internal Container App while in `audit`. Confirm the StreamGate logs show the
actual expected client IP. If Azure Container Apps TCP ingress reports only a
proxy/private address for external clients, application-level client IP
allow-listing is not reliable and must move to a network-layer control or a TCP
proxy that preserves the source IP.

#### 4. RTMP Disconnect Notification (Optional)
**Endpoint:** `POST /api/rtmp/disconnect` (Internal)

Called by rtmp-go when RTMP stream ends. Closes the RtmpSession.

**Authentication:** `X-Internal-Api-Key` header

**Request Body:**
```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Closed 1 session(s)"
}
```

#### 5. RTMP Native Hook Events
**Endpoint:** `POST /api/rtmp/hooks` (Internal)

Called by rtmp-go's native hook system for lifecycle events such as `publish_start`
and `publish_stop`. Streamgate uses `publish_stop` to close active `RtmpSession`
records when OBS or another publisher disconnects without going through the legacy
`/api/rtmp/disconnect` flow.

**Authentication:** `X-Internal-Api-Key` header

**Request Body:**
```json
{
  "type": "publish_stop",
  "timestamp": 1714380000,
  "conn_id": "conn_abc123",
  "stream_key": "live/tech-talk-2024-a3b2c1d0e9f8",
  "data": {
    "audio_packets": 1234,
    "video_packets": 5678,
    "total_bytes": 12345678,
    "audio_codec": "AAC",
    "video_codec": "H.264",
    "duration_sec": 3600.5
  }
}
```

**Important stream key mapping:**
- rtmp-go sends `stream_key` in `app/streamName` format (for example `live/tech-talk-2024-a3b2c1d0e9f8`)
- Streamgate stores only the `streamName` portion in `Event.rtmpStreamKeyHash`
- The hook receiver strips the app prefix before doing the database lookup

**Response (200 OK):**
```json
{
  "ok": true,
  "action": "session_closed",
  "closedSessions": 1
}
```

Other actions:
- `logged` for `publish_start`
- `ignored` for unknown events, missing `stream_key`, or stream keys that do not map to an Event

### Publisher Flow

```
1. Admin creates Event in streamgate
   ↓ Auto-generates rtmpStreamKeyHash + rtmpToken
   ↓

2. Publisher receives stream key hash and token (out-of-band)
   Example: stream key = "tech-talk-2024-a3b2c1d0e9f8"
            token = "abc123def456ghi789jkl012XY"
   ↓

3. Publisher publishes via RTMP:
   rtmp://rtmp-server:1935/live/tech-talk-2024-a3b2c1d0e9f8?token=abc123def456ghi789jkl012XY
   ↓

4. rtmp-go receives PUBLISH command
   ├─ Extracts streamKeyHash = "tech-talk-2024-a3b2c1d0e9f8"
   ├─ Extracts token from query params
   ├─ Makes webhook call to streamgate: POST /api/rtmp/auth
   │  Headers: X-Internal-Api-Key: <secret>
   │  Body: { streamKeyHash, token, action: "publish", publisherIp }
   ↓

5. streamgate validates webhook
   ├─ Lookup Event by rtmpStreamKeyHash
   ├─ Verify token matches Event.rtmpToken
   ├─ Check token not expired (rtmpTokenExpiresAt)
   ├─ For PUBLISH: check single-publisher (no active RtmpSession)
   ├─ Create RtmpSession record
   ├─ Return 200 OK + event metadata
   ↓

6. rtmp-go allows/denies publish based on response status
   ├─ 200 OK → Allow PUBLISH, use eventId for storage/relay
   └─ 403 Forbidden → Deny with reason (can show to user)
   ↓

7. Stream is ingested to /streams/{eventId}/
   ↓

8. On stream end, rtmp-go emits a native hook event:
   POST /api/rtmp/hooks
   Body: { type: "publish_stop", stream_key: "live/{streamKeyHash}", conn_id, data }
   ↓

9. streamgate strips the `live/` app prefix, looks up Event by `rtmpStreamKeyHash`,
   and closes active RtmpSession records (endedAt = now())
   ↓

10. Publisher can reconnect without hitting `already_streaming`, and the audit trail
    remains preserved in RtmpSession records
```

## Configuration

### streamgate Environment Variables

```bash
# Required for webhook auth
INTERNAL_API_KEY=<shared-secret-with-rtmp-go>

# Database (existing)
DATABASE_URL=postgresql://...

# RTMP webhook callback (optional, for testing)
RTMP_SERVER_URL=http://localhost:4000

# RTMP PLAY IP allow-list rollout
RTMP_PLAY_IP_ALLOWLIST_MODE=audit
RTMP_INTERNAL_PLAY_ALLOWED_CIDRS=10.0.0.0/16
```

### rtmp-go Environment Variables

```bash
# Enable per-event token support
INTERNAL_API_KEY=<same-secret-as-streamgate>

# Example: -auth-mode callback -auth-callback http://platform-app:3000/api/rtmp/auth
# The INTERNAL_API_KEY env var enables per-event token format
```

### rtmp-go CLI Flags

```bash
# Legacy token mode (backward compatible)
./rtmp-server -listen :1935 \
  -auth-mode token \
  -auth-token "live/stream1=token123" \
  -auth-token "live/stream2=token456"

# Callback mode (new per-event tokens)
./rtmp-server -listen :1935 \
  -auth-mode callback \
  -auth-callback http://platform-app:3000/api/rtmp/auth \
  -auth-callback-timeout 5s

# Environment variable controls format:
# If INTERNAL_API_KEY is set → use per-event token format
# If INTERNAL_API_KEY is not set → use legacy format
export INTERNAL_API_KEY=shared-secret
./rtmp-server -listen :1935 \
  -auth-mode callback \
  -auth-callback http://platform-app:3000/api/rtmp/auth
```

## Security Considerations

### Token Lifecycle
1. **Generation**: Deterministic HMAC-based, reproducible from eventId + title
2. **Storage**: Encrypted at rest in database (AES-256-GCM)
3. **Transmission**: Only over HTTPS (to rtmp-go via env var or secure config)
4. **Expiry**: Hard limit at event.endsAt; no automatic refresh
5. **Rotation**: Admin can rotate anytime via token rotation endpoint

### Single Publisher Enforcement
- **Mechanism**: RtmpSession records track active streams per event
- **Scope**: One active RTMP stream per event at a time
- **Enforcement**: Webhook rejects PUBLISH if RtmpSession.endedAt IS NULL
- **Audit Trail**: All attempts logged via RtmpSession (startedAt, endedAt, IP)

### Rate Limiting (Recommended, not implemented)
- Webhook calls: 5-10 per second per streamKeyHash (prevent brute force)
- Token validation failures: Exponential backoff or circuit breaker

### Webhook Timeout
- Default: 5 seconds
- Behavior: Deny publish if webhook doesn't respond (fail-closed)
- Retry logic: rtmp-go can retry with exponential backoff (optional)

### IP Logging & Audit Trail
- Publisher IP captured in RtmpSession.rtmpPublisherIp
- Timestamp captured: startedAt, endedAt
- Enables post-hoc analysis of who published when

## Backward Compatibility

The callback validator in rtmp-go supports **both** old and new formats:

- **Legacy format** (old): Sends `stream_name` + global `token` in body
- **New format** (per-event): Sends `streamKeyHash` + per-event `token` in body + `X-Internal-Api-Key` header

Detected by: presence of `INTERNAL_API_KEY` environment variable

```go
// rtmp-go/internal/rtmp/server/auth/callback.go
if v.EnablePerEventTokens {
  // Use new per-event format with X-Internal-Api-Key header
} else {
  // Use legacy format (backward compatible)
}
```

## Testing

### Unit Tests
- **rtmp-tokens.test.ts**: Token generation, validation, format checking
- **auth.test.ts**: Webhook endpoint, authorization logic, single-publisher enforcement

### Integration Tests (E2E)
1. Create event → verify RTMP tokens generated
2. Publish to rtmp://host/stream-key?token=<token> → verify webhook called
3. Verify single-publisher enforcement (second publish rejected)
4. Verify token expiry (publish after event ends rejected)
5. Rotate token → verify old token rejected, new token works

### Manual Testing

```bash
# Terminal 1: Start streamgate
cd streamgate/platform
npm run dev

# Terminal 2: Start rtmp-go with per-event tokens
cd rtmp-go
export INTERNAL_API_KEY=dev-secret
PLAYBACK_SIGNING_SECRET=dev-secret \
  ./rtmp-server -listen :1935 \
  -auth-mode callback \
  -auth-callback http://localhost:3000/api/rtmp/auth \
  -record-all true

# Terminal 3: Create an event via API
curl -X POST http://localhost:3000/api/creator/events \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Stream",
    "startsAt": "2024-04-27T12:00:00Z",
    "endsAt": "2024-04-27T14:00:00Z"
  }'

# Terminal 4: Publish RTMP stream (will use generated stream key + token)
ffmpeg -re -i test.mp4 -c copy -f flv \
  "rtmp://localhost:1935/live/{streamKeyHash}?token={rtmpToken}"

# Terminal 5: Try to publish with wrong token (should fail with 403)
ffmpeg -re -i test.mp4 -c copy -f flv \
  "rtmp://localhost:1935/live/{streamKeyHash}?token=wrong_token"
```

## Deployment Checklist

- [ ] Update RTMP server environment: set `INTERNAL_API_KEY` in rtmp-go config
- [ ] Verify webhook URL: `http://platform-app:3000/api/rtmp/auth` is accessible from rtmp-go
- [ ] Verify hook URL: `http://platform-app:3000/api/rtmp/hooks` is accessible from rtmp-go
- [ ] Test event creation: verify RTMP tokens are generated
- [ ] Test publish: verify webhook is called and stream accepted
- [ ] Test single-publisher: verify second publish is rejected
- [ ] Test publish stop: stop OBS/ffmpeg and verify `publish_stop` closes the active `RtmpSession`
- [ ] Test reconnect: after stopping OBS/ffmpeg, verify the next publish no longer fails with `already_streaming`
- [ ] Test token expiry: verify publish rejected after event.endsAt
- [ ] Monitor logs: watch for webhook failures, timeouts, database errors
- [ ] Audit trail: verify RtmpSession records are created and closed

## Future Enhancements

1. **Per-event storage configuration**: Allow custom storage path per event
2. **Bitrate limiting**: Enforce maximum bitrate per event in webhook response
3. **Webhook retry logic**: Exponential backoff for webhook failures
4. **Rate limiting**: Implement token validation rate limiting
5. **Token expiry grace period**: Allow N seconds of publish after event.endsAt
6. **Multi-publisher events**: Optional mode for N concurrent publishers (with quotas)
7. **RTMP metrics**: Track published bitrates, codecs, session duration per event
8. **Admin dashboard**: UI for RTMP session monitoring and manual disconnection
