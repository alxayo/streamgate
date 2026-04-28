---
sidebar_position: 5
title: Admin Console
---

# Admin Console

The Admin Console is StreamGate's management interface for event organizers. Create streaming events, generate and distribute access codes, monitor active viewers, and control access — all from a web-based dashboard.

## Accessing the Admin Console

Navigate to `/admin` on your StreamGate instance:

```
http://localhost:3000/admin
```

### Logging In

StreamGate uses multi-step authentication with mandatory two-factor verification:

1. **Enter your username and password** — The default super admin account is `admin` with the password set during initial setup
2. **Enter your 6-digit TOTP code** — From your authenticator app (Google Authenticator, Authy, 1Password, etc.)
3. **First-time setup** — On your first login, you'll be guided through a 4-step 2FA enrollment wizard

:::info Session persistence
After logging in, your session is maintained via an encrypted HTTP-only cookie (using `iron-session`). You'll stay logged in until you explicitly log out or the session cookie expires (8 hours).
:::

### First-Time 2FA Setup

When logging in for the first time (or after a 2FA reset), you'll complete a setup wizard:

1. **Introduction** — Explains why 2FA is required
2. **QR Code** — Scan with your authenticator app (or manually enter the secret key)
3. **Verification** — Enter a 6-digit code to confirm your authenticator is working
4. **Recovery Codes** — Save your 8 one-time recovery codes securely

:::danger Save your recovery codes!
Recovery codes are shown **only once** during setup. Each code can be used exactly once to log in if you lose access to your authenticator app. Store them in a password manager or printed in a secure location.
:::

### Lost Access / Password Reset

| Situation | Solution |
|-----------|----------|
| Lost authenticator app | Use a recovery code (click "Use recovery code" on login) |
| Lost recovery codes too | Ask a Super Admin to reset your 2FA from the Users page |
| Only admin & locked out | Use emergency login with `ADMIN_SESSION_SECRET` (see deployment guide) |
| Forgot password | A Super Admin can update your password from the Users page |

---

## User Roles and Permissions

StreamGate uses role-based access control (RBAC) with three levels:

| Role | Description | Capabilities |
|------|-------------|--------------|
| **Super Admin** | Full system access | Everything + user management + audit log |
| **Admin** | Event & token management | Events, tokens, settings, dashboard |
| **Operator** | Read-only monitoring | Dashboard viewing only |

The sidebar navigation automatically shows only the sections your role permits.

---

## User Management (Super Admin Only)

Super Admins can create and manage admin user accounts:

### Creating a User

1. Navigate to **Users** in the sidebar
2. Click **"Add User"**
3. Fill in: username, password, and role
4. Click **"Create"**

The new user will be prompted to set up 2FA on their first login.

### Managing Users

From the Users page, you can:

- **Edit** — Change username, role, or password
- **Reset 2FA** — Forces the user to re-enroll 2FA on next login (useful if they lose their authenticator)
- **Deactivate** — Disables the account (user cannot log in). Can be reactivated later.

:::warning Safety guards
You cannot deactivate your own account or change your own role — this prevents accidental lockouts.
:::

---

## Audit Log (Super Admin Only)

The audit log provides an immutable record of all admin actions:

- **Login events** — Successful and failed login attempts
- **User management** — Account creation, role changes, 2FA resets, deactivations
- **Session events** — Logout, emergency login usage
- **Content actions** — Event/token operations (when logged)

### Filtering

Filter the audit log by:
- **Action type** — e.g., `login_success`, `user_created`, `2fa_reset`
- **Username** — Filter by who performed the action
- **Date range** — Show entries within a specific time window

---

## Dashboard

The dashboard provides an at-a-glance overview:

- **Active Events** — Events currently within their start/end time window
- **Upcoming Events** — Scheduled but not yet started
- **Total Tokens** — Count of all generated tokens across events
- **Active Sessions** — Currently watching viewers in real-time

---

## Managing Events

### Creating an Event

1. Click **"Create Event"** from the dashboard or events list
2. Fill in the event details:

| Field | Required | Description |
|-------|----------|-------------|
| **Title** | ✅ | Event name displayed to viewers (e.g., "Annual Conference 2025") |
| **Description** | ❌ | Event details shown on the viewer portal |
| **Starts At** | ✅ | When the live stream begins (date + time) |
| **Ends At** | ✅ | When the live stream ends (date + time) |
| **Access Window (hours)** | ✅ | Hours after `Ends At` that tokens remain valid for VOD rewatch (default: 48) |
| **Stream URL** | ❌ | Override upstream URL for proxy mode (leave blank for convention-based paths) |
| **Poster URL** | ❌ | Thumbnail image URL shown before the stream starts |

3. Click **"Save"**

:::tip Access window
The access window controls how long viewers can rewatch after the live event ends. Set to `0` for live-only events with no rewatch. Set to `168` (one week) for extended access.
:::

### Editing an Event

Click on an event from the events list to view its details, then click **"Edit"** to modify any field. Changes take effect immediately — existing viewers may need to refresh their player.

:::warning Changing times
If you shorten the event's end time, any tokens computed with the old end time will have their access window shortened accordingly. Token `expiresAt` is calculated as `endsAt + accessWindowHours`.
:::

### Event States

| State | Meaning | Admin Action |
|-------|---------|--------------|
| **Active** | Event is enabled, tokens can be used | Default state |
| **Deactivated** | All access suspended immediately | Toggle `isActive` off |
| **Archived** | Hidden from default views, access may still work if within window | Toggle `isArchived` on |

### Deactivating an Event

Deactivating an event immediately suspends **all** access for that event:

- All active viewers are disconnected (within 30 seconds, as the HLS server syncs its revocation cache)
- No new tokens can be redeemed
- Existing tokens for this event become non-functional

To deactivate: Open the event → Click **"Deactivate"** (or toggle the Active switch off).

To reactivate: Open the event → Click **"Activate"** (or toggle the Active switch on).

### Deleting an Event

Deleting an event permanently removes it and **all associated tokens**. This action cannot be undone.

:::danger Permanent action
Deletion cascades to all tokens and active sessions. Only delete events that are no longer needed. Consider archiving instead.
:::

---

## Managing Tokens

### Generating Tokens

From an event's detail page:

1. Click **"Generate Tokens"**
2. Choose the quantity (1 to 500 per batch)
3. Optionally add a **label** (e.g., "VIP Batch", "John Smith", "Marketing Team") — labels help you identify tokens later
4. Click **"Generate"**

Tokens are created using cryptographically secure random generation (`crypto.randomBytes`), producing 12-character alphanumeric codes (base62: `a-z`, `A-Z`, `0-9`).

:::info Batch size limit
You can generate up to **500 tokens** in a single batch. For larger quantities, run multiple batches. Token generation uses database transactions to ensure atomicity.
:::

### Token List

The token list for each event shows all generated tokens with:

- **Code** — The 12-character access code
- **Label** — Admin-assigned label (if any)
- **Status** — Current state (see below)
- **Created** — When the token was generated
- **Redeemed** — When first used (if applicable)
- **Expires** — Expiration date/time

#### Filtering and Searching

- **Search** — Filter by token code or label
- **Status filter** — Show only tokens with a specific status
- **Sort** — Order by creation date, redemption date, or status

### Token Statuses

| Status | Icon | Meaning |
|--------|------|---------|
| **Unused** | 🔵 | Generated but never redeemed by a viewer |
| **Redeemed** | 🟢 | Successfully used by a viewer at least once |
| **Active** | 🟢 (pulsing) | A viewer is currently watching with this token |
| **Expired** | ⚫ | Past the access window (`endsAt + accessWindowHours`) |
| **Revoked** | 🔴 | Manually revoked by an admin |

### Revoking Tokens

Revocation immediately blocks a token from being used:

#### Single Token Revocation
1. Find the token in the list
2. Click the **"Revoke"** action
3. Confirm the revocation

#### Bulk Revocation
1. Select multiple tokens using checkboxes
2. Click **"Revoke Selected"**
3. Confirm the bulk action

#### What Happens on Revocation

- If the viewer is currently watching, their stream stops within **30 seconds** (next HLS server revocation sync cycle)
- The token code can no longer be used to gain access
- The revocation is synced to all HLS server instances via the revocation polling mechanism

#### Un-Revoking a Token

If a token was revoked by mistake:

1. Find the revoked token in the list
2. Click **"Un-revoke"** (or **"Restore"**)
3. The token returns to its previous state (unused or redeemed)

:::note Revocation sync delay
There is a maximum **30-second delay** between revoking a token in the admin console and the HLS server blocking that token. This is by design — the HLS server polls for revocation updates every 30 seconds to avoid constant database queries.
:::

### Exporting Tokens

Export your token list as a **CSV file** for distribution:

1. Navigate to the event's token list
2. Click **"Export CSV"**
3. The download includes: code, label, status, created date, expiry date

:::tip Distribution workflow
A typical workflow: generate a batch of tokens with labels → export as CSV → use the CSV to send personalized emails with each viewer's unique code.
:::

---

## Monitoring Active Sessions

The admin console shows real-time session information:

- **Active Sessions count** per event
- **Per-token session details**: client IP, user agent, last heartbeat time
- **Session duration**: how long the viewer has been watching

### Force-Releasing a Session

If a token shows as "in use" but the viewer is no longer watching (e.g., browser crashed):

1. Find the active session in the token details
2. Click **"Release Session"**
3. The session is immediately freed, and the token can be used again

:::info Automatic cleanup
Abandoned sessions are automatically cleaned up after the configured timeout (default: 60 seconds of missed heartbeats). Manual release is rarely needed.
:::

---

## Best Practices

### Before the Event
- Create the event well in advance
- Generate tokens in batches with descriptive labels
- For VOD events, upload the video file and wait for transcoding to complete before distributing tokens
- Export and distribute tokens to your audience
- Test with one token to verify the stream works end-to-end

### During the Event
- Monitor active sessions to gauge viewership
- Keep the admin console open to handle support requests
- Have spare tokens available for last-minute attendees

### After the Event
- Review session statistics
- Revoke any unused tokens if not needed for VOD rewatch
- Archive the event when the access window closes

---

## VOD Upload & Transcoding

StreamGate supports Video-on-Demand (VOD) uploads in addition to live streaming. Creators and admins can upload a pre-recorded video file for an event, and the system transcodes it into multiple quality levels and codecs for HLS playback.

### Uploading a Video

From an event's detail page:

1. Click the **"Upload Video"** button (or the upload area)
2. Select a video file (MP4, MOV, MKV, WebM, AVI, or MPEG-TS)
3. The file uploads directly to Azure Blob Storage with a real-time progress bar
4. Once the upload completes, transcoding starts automatically

:::info File size limit
The maximum upload size is configurable in **Settings** (default: 5 GB). Large files are streamed in chunks — the browser does not need to load the entire file into memory.
:::

### Transcoding Pipeline

After upload, the platform launches one transcoding job per enabled codec:

| Codec | Container | Description |
|-------|-----------|-------------|
| **H.264** | fMP4 segments | Most compatible — works on all devices and browsers |
| **AV1** | fMP4 segments | Best compression efficiency, newer devices only |
| **VP9** | fMP4 segments | Good compression, wide browser support |
| **VP8** | MPEG-TS segments | Legacy format, broadest compatibility |

Each job runs as an independent Azure Container Apps Job and reports progress back to the platform.

### Monitoring Transcoding

The event detail page shows transcoding status in real time:

- **Per-codec progress bars** — Shows percentage completion for each codec (H.264, AV1, etc.)
- **Job status** — Queued → Running → Completed / Failed
- **Overall status** — The upload is marked READY when all enabled codecs complete successfully

| Upload Status | Meaning |
|---------------|---------|
| **UPLOADING** | File is being uploaded to blob storage |
| **UPLOADED** | Upload complete, waiting for transcoding to start |
| **TRANSCODING** | One or more transcoder jobs are running |
| **READY** | All codec transcodes completed — video is playable |
| **FAILED** | One or more transcodes failed (partial playback may still work if some codecs succeeded) |

### Re-Transcoding

If transcoding fails or you want to re-encode with different settings:

1. Open the event detail page
2. Click **"Re-transcode"**
3. New transcoding jobs are launched for all enabled codecs

### Preview Playback

Once at least one codec completes transcoding:

1. The event detail page shows a **"Preview"** button
2. Click to open the HLS player with a short-lived admin preview token
3. The player loads the multi-codec master playlist and auto-selects the best quality

### Configuring Codecs and Quality

Navigate to **Settings** to configure:

- **Enabled codecs** — Choose which codecs to transcode (H.264 is always enabled)
- **Rendition ladders** — Per-codec quality levels (resolution, bitrate). Default: 1080p, 720p, 480p for H.264
- **Maximum upload size** — File size limit for VOD uploads (default: 5 GB)

---

## System Configuration

The **System Configuration** page (`/admin/config`) lets Super Admins and Admins manage shared secrets used by StreamGate's services. Navigate to **Config** in the sidebar to access it.

### What It Shows

The page displays all shared configuration keys in a table:

| Column | Description |
|--------|-------------|
| **Key** | The configuration key name (e.g., `PLAYBACK_SIGNING_SECRET`) |
| **Value** | The current value, masked for security (click to reveal temporarily) |
| **Source** | Where the value comes from — **ENV** (environment variable) or **DB** (database) |
| **Last Updated** | When the value was last changed (DB values only) |

### Editing a Value

1. Click the **Edit** (pencil) icon next to the key you want to change
2. Enter the new value
3. Click **Save**

If the key is currently sourced from an environment variable, the ENV value always takes priority. To use DB-managed values, remove the corresponding environment variable and restart the service.

### Regenerating a Secret

For secrets that don't need to match an external system (like `PLAYBACK_SIGNING_SECRET` or `INTERNAL_API_KEY`):

1. Click the **Regenerate** button next to the key
2. Confirm the action in the dialog — this generates a new cryptographically secure random value
3. Restart the HLS Media Server to pick up the new value

:::danger Regenerating shared secrets
Regenerating `PLAYBACK_SIGNING_SECRET` invalidates **all** active viewer sessions immediately — every connected viewer will need to re-enter their access code. Only regenerate this secret during planned maintenance windows.
:::

:::warning Restart required
After changing any shared secret, restart the HLS Media Server for the change to take effect. The Platform App picks up DB changes immediately, but the HLS server caches secrets at startup.
:::
