---
sidebar_position: 6
title: Creator Portal
---

# Creator Portal

The Creator Portal is a self-service interface for content creators who stream on your platform. Creators manage their own events, generate access tokens, and view ingest credentials — without needing admin access.

## Overview

| Feature | Description |
|---------|-------------|
| **Registration** | Creators sign up with email + password |
| **Channels** | Each creator owns a channel (brand namespace for their events) |
| **Event Management** | Create, edit, deactivate, and archive streaming events |
| **Token Generation** | Generate batch access codes for viewers |
| **Ingest Credentials** | View RTMP/SRT stream keys directly in the dashboard |
| **VOD Conversion** | Convert finished live events to on-demand archives |

---

## Accessing the Creator Portal

Navigate to `/creator` on your StreamGate instance:

```
http://localhost:3000/creator
```

### Registration

1. Go to `/creator/register`
2. Enter your **email**, **password** (minimum 8 characters), and **display name**
3. Depending on your platform's configuration:
   - **Open mode** — You're logged in immediately
   - **Approval mode** — Your account is created but you must wait for an admin to approve it
   - **Disabled mode** — Registration is closed; only admins can create creator accounts

:::info Registration Mode
The admin controls registration mode from **Admin Console → Settings → Creator Registration**. Options are: Open, Approval Required, or Disabled.
:::

### Logging In

1. Go to `/creator/login`
2. Enter your email and password
3. On success, you're redirected to the Creator Dashboard

:::warning Account Lockout
After 5 consecutive failed login attempts, your account is temporarily locked for 15 minutes. An admin can unlock it from the Creators management page.
:::

---

## Creator Dashboard

After logging in, you'll see your channel overview:

- **Channel name** — Your public-facing brand
- **Total Events** — Number of events you've created
- **Total Tokens** — Access codes issued across all your events
- **Quick link** — "New Event" button to create a streaming event

---

## Managing Events

### Creating an Event

1. Click **"New Event"** from the dashboard or events list
2. Fill in:
   - **Title** — Event name shown to viewers
   - **Stream Type** — `LIVE` (real-time) or `VOD` (pre-recorded)
   - **Start / End Date** — When the event is scheduled
   - **Access Window** — Hours after `endsAt` that tokens remain valid (default: 48)
   - **Stream URL** (optional, VOD only) — Direct URL to a pre-existing `.m3u8`
3. Click **Create**

### Editing an Event

From the event detail page, click the edit icon to modify:
- Title, description, dates, access window, stream URL

### Deactivating / Archiving

- **Deactivate** — Marks the event inactive; viewers can no longer validate tokens for it
- **Convert to VOD** — Changes stream type to VOD, deactivates the live event, marks as archived
- **Purge Cache** — Deletes HLS segments from the media server (useful after test streams)

---

## Generating Access Tokens

From an event's detail page:

1. Click **"Generate Tokens"**
2. Choose a **count** (1–500 per batch)
3. Optionally add a **label** (e.g., "VIP Batch" or "Press Pass")
4. Tokens are created instantly — each is a unique 12-character alphanumeric code

Share these codes with your viewers. Each code allows one device to watch at a time.

---

## Ingest Credentials (Streaming Setup)

For LIVE events, the event detail page shows your ingest endpoints:

| Field | Example |
|-------|---------|
| **Server** | `rtmp://stream.example.com:1935` |
| **Stream Key** | `live/your-event-uuid?token=YOUR_TOKEN` |

### OBS Studio Setup

1. Open **Settings → Stream**
2. Set **Service** to "Custom"
3. Paste the **Server** URL
4. Paste the **Stream Key** (includes the auth token)
5. Click **Start Streaming**

### FFmpeg Example

```bash
ffmpeg -re -i input.mp4 -c copy -f flv \
  "rtmp://stream.example.com:1935/live/EVENT_UUID?token=YOUR_TOKEN"
```

:::tip
The ingest token is the platform's `RTMP_AUTH_TOKEN`. It's the same for all events — the event UUID in the stream key identifies which event you're streaming to.
:::

---

## Channel Settings

From the Creator Dashboard, you can update your channel:
- **Channel Name** — Display name for your brand
- **Description** — Brief channel description
- **Logo URL** — Link to a branding image

---

## Security

- Creators have **no access** to the Admin Console
- Creator sessions are independent from admin sessions (separate cookies)
- Creators can only see and manage **their own channel's events**
- If a channel is suspended by an admin, the creator's events will reject new RTMP publishes
- All passwords are stored as bcrypt hashes (12 salt rounds)

---

## Admin Oversight

Admins retain full control over creators:

| Action | Location |
|--------|----------|
| View all creators | Admin Console → Creators |
| Approve pending registrations | Creators page → "Approve" button |
| Suspend/unsuspend a creator | Creators page → toggle |
| Unlock a locked account | Creators page → "Unlock" button |
| Suspend/unsuspend a channel | Creators page → channel toggle |
| Set registration mode | Admin Console → Settings → Creator Registration |

When a channel is suspended, RTMP publish attempts for that channel's events will be rejected by the auth callback.
