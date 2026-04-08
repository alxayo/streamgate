---
sidebar_position: 4
title: Viewer Portal
---

# Viewer Portal

The Viewer Portal is the public-facing side of StreamGate — where your audience enters their access codes and watches streams. No accounts, no sign-ups, just a code and instant playback.

## Entering a Token Code

1. Navigate to your StreamGate instance (e.g., `http://localhost:3000`)
2. You'll see a clean token entry screen with a single input field
3. Enter or paste your **12-character alphanumeric access code**
4. Click **"Watch"** or press **Enter**

:::tip Paste-friendly
The token field accepts pasted codes. Viewers can copy their code from an email, ticket, or message and paste directly — no manual typing needed.
:::

### What Happens on Entry

When a viewer submits a code, StreamGate:

1. **Validates the code** against the database
2. **Checks the event status** — is it active? Is it within the access window?
3. **Checks for active sessions** — is someone else already using this code?
4. **Creates a session** and issues a short-lived JWT playback token
5. **Redirects to the player** — the stream starts automatically

### Error Messages

| Message | Meaning | What to Do |
|---------|---------|------------|
| "Invalid access code" | Code doesn't exist or is malformed | Double-check the code for typos |
| "Access code has been revoked" | Admin revoked this code | Contact the event organizer |
| "Access code has expired" | The event's access window has closed | The event is no longer available |
| "Event is no longer available" | The event has been deactivated | Contact the event organizer |
| "This code is already in use" | Another device is actively watching | Close the other session first, or wait for it to time out |
| "Too many attempts" | Rate limit hit (5 attempts/min) | Wait a minute and try again |

## The Player

Once validated, viewers see a full-screen-optimized video player powered by hls.js.

### Player Controls

The player includes standard video controls:

- **Play / Pause** — Click the video or the play button
- **Volume** — Slider control + mute toggle
- **Fullscreen** — Expand to fill the screen
- **Quality Selector** — Choose stream quality (when adaptive bitrate streams are available)
- **Progress Bar** — Shows playback position (for VOD / recordings)

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Space** | Play / Pause |
| **F** | Toggle fullscreen |
| **M** | Toggle mute |
| **↑ / ↓** | Volume up / down |
| **← / →** | Seek backward / forward (VOD only) |
| **Escape** | Exit fullscreen |

### Player States

The player adapts to the event's current state:

#### Pre-Event (Before `startsAt`)
The player shows a waiting screen with the event title and a countdown to the scheduled start time. The viewer doesn't need to re-enter their code — the player automatically begins playback when the stream goes live.

#### Live Event (Between `startsAt` and `endsAt`)
The player shows the live stream. A "LIVE" indicator appears in the player controls. Seeking is limited to the available buffer (typically the last 20–60 seconds, depending on HLS segment configuration).

#### Post-Event / Recording (After `endsAt`, Within Access Window)
If the stream files are still available, viewers can rewatch the recording. Full seek is available. The access window is configured by the event's `accessWindowHours` setting (default: 48 hours after the event ends).

#### Expired
After the access window closes, the player shows an "Access has expired" message. The viewer's token is no longer valid.

## Session Behavior

StreamGate tracks active viewing sessions to enforce single-device access and manage resources.

### Heartbeat

While watching, the player silently sends a **heartbeat signal** to the Platform App every **30 seconds**. This:

- Confirms the viewer is still actively watching
- Keeps the session alive
- Allows the system to detect abandoned sessions

If a heartbeat fails (network issue, server restart), the player will display a reconnection notice and attempt to re-establish the session.

### Session Release

When a viewer closes the browser tab, navigates away, or stops watching:

- The player sends a **release signal** to free the session
- This happens automatically via `navigator.sendBeacon()` — no action required from the viewer
- The token is immediately available for use on another device

:::info Abandoned sessions
If a viewer's browser crashes or loses internet, the session can't be released normally. Abandoned sessions are automatically cleaned up after the configured timeout period (default: 60 seconds of missed heartbeats).
:::

### JWT Token Refresh

The player's JWT playback token expires every **60 minutes**. At the **50-minute mark**, the player automatically requests a fresh token in the background — no interruption to playback. This is entirely invisible to the viewer.

If a refresh fails (e.g., the token was revoked), the player will display a message and stop playback.

## Single-Device Enforcement

Each access code can only be used on **one device at a time**. This prevents code sharing and unauthorized concurrent viewing.

### How It Works

1. Viewer A enters a code → Session is created → Playback starts
2. Viewer B enters the **same** code → Sees "This code is already in use"
3. Viewer A closes their browser → Session is released
4. Viewer B can now use the code

### "Token In Use" — What It Means

If you see this message, it means someone (possibly you on another device or tab) is currently watching with this code. To resolve:

- **Close other tabs/devices** that might be using the same code
- **Wait up to 60 seconds** — if the other session was abandoned (browser crashed, lost internet), it will automatically expire
- **Contact the organizer** — an admin can see active sessions and help resolve conflicts

:::tip Multiple devices
If you need viewers to watch on multiple devices simultaneously, generate separate access codes for each device. Each code is independent.
:::

## Safari Compatibility

StreamGate supports Safari on macOS and iOS, with some notes:

- **Native HLS**: Safari uses its native HLS player instead of hls.js, which handles JWT authentication via a query parameter fallback
- **Autoplay**: Safari may block autoplay with sound — the player handles this gracefully with a "Click to play" overlay
- **Picture-in-Picture**: Supported on Safari — use the native PiP button in the player controls
- **iOS fullscreen**: On iPhone, video plays in the native fullscreen player by default

:::note Safari token handling
For Safari compatibility, the player falls back to passing the JWT via a `__token` query parameter instead of the `Authorization` header. This is handled automatically — no viewer action needed. The query parameter is stripped from server logs for security.
:::

## Accessibility

The player supports standard accessibility features:

- Full keyboard navigation (see keyboard shortcuts above)
- Screen reader-compatible controls
- High-contrast control overlays
- Focus indicators on interactive elements

## Network Requirements

For smooth playback, viewers need:

| Stream Quality | Minimum Bandwidth |
|---------------|-------------------|
| 480p | 1.5 Mbps |
| 720p | 3 Mbps |
| 1080p | 6 Mbps |
| Adaptive (auto) | 1.5 Mbps+ (adjusts quality dynamically) |

The player automatically adjusts quality based on available bandwidth when adaptive bitrate streams are configured.
