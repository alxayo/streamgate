# DRM Licensing Costs & Browser Support Matrix

## DRM System Licensing Costs

### FairPlay (Apple)
- **Cost: Free**, but gated by Apple
- Must sign Apple's FairPlay Streaming License Agreement via the Apple Developer Program ($99/year)
- Apple provides a private key + application certificate to register with your DRM provider
- No per-license fees to Apple
- The gate is legal/contractual, not financial

### Widevine (Google)
- **Cost: Free**
- Google acquired Widevine in 2010 and made it free for all web use
- Built into Chrome, Firefox, Edge, and Android — no registration with Google required
- No fees, no agreements, no application process for client-side use

### PlayReady (Microsoft)
- **Cost: Free for web/software use**
- Free to use in browsers via the EME API
- Microsoft charges device manufacturers (TV vendors, set-top boxes) hardware licensing fees — not your cost
- No fees or registration needed for web streaming

### Where You Actually Pay: Multi-DRM SaaS Provider

| What they charge for | Typical cost |
|---------------------|-------------|
| License issuance (per license request) | ~$0.001–$0.01 per license |
| Monthly flat rate (unlimited licenses) | $200–$2,000+/month |
| Key storage / content registration | Usually included |

---

## Why You Can't Fully Go Direct (Without a SaaS Provider)

| Task | DIY | SaaS Provider |
|------|-----|---------------|
| Widevine license server | ❌ Requires Google NDA/agreement (not publicly available) | ✅ Included |
| PlayReady license server | ⚠️ Requires Microsoft agreement + SDK | ✅ Included |
| FairPlay license server | ✅ Fully DIY-able (Apple publishes the spec) | ✅ Included |
| Key storage (HSM-grade) | ⚠️ You need a secure key store | ✅ Included |
| Widevine device certificate validation | ❌ Requires closed SDK | ✅ Included |

**The blocker is Widevine.** Google has kept the server SDK proprietary and only distributes it to large
media companies under NDA. Without it you cannot issue Widevine licenses — no DRM on Chrome,
Firefox, or Android. This is the primary reason SaaS DRM providers exist.

### Hybrid Option
- **FairPlay**: Self-hosted (Apple gives you everything you need)
- **Widevine + PlayReady**: SaaS provider (required for Widevine access)

---

## Browser & Platform Support Matrix

### Desktop Browsers

| Browser | Windows | macOS | Linux |
|---------|---------|-------|-------|
| Chrome 35+ | Widevine ✅ | Widevine ✅ | Widevine ✅ |
| Firefox 47+ | Widevine ✅ | Widevine ✅ | Widevine ✅ |
| Edge (Chromium) | Widevine ✅ PlayReady ✅ | Widevine ✅ | Widevine ✅ |
| Edge (Legacy) | PlayReady ✅ | N/A | N/A |
| Safari 12.1+ | N/A | FairPlay ✅ | N/A |
| Safari < 12.1 | N/A | ❌ No EME | N/A |
| Opera | Widevine ✅ | Widevine ✅ | Widevine ✅ |
| Brave | Widevine ✅* | Widevine ✅* | Widevine ✅* |

*Brave requires the user to explicitly enable Widevine in settings.

### Mobile Browsers

| Browser | iOS / iPadOS | Android |
|---------|-------------|---------|
| Safari (iOS 11.2+) | FairPlay ✅ | N/A |
| Chrome for iOS | FairPlay ✅† | Widevine ✅ |
| Firefox for iOS | FairPlay ✅† | Widevine ✅ |
| Samsung Internet | N/A | Widevine ✅ |
| Firefox for Android | N/A | Widevine ✅ |
| Edge for Android | N/A | Widevine ✅ |

† All iOS browsers use Apple's WebKit engine (App Store mandate). They all route DRM through
FairPlay. There is no Widevine on iOS, ever.

### Widevine Security Levels

| Level | Where | Notes |
|-------|-------|-------|
| L1 | Most Android phones (2018+), Chromebooks | Full HD/4K allowed; hardware TEE |
| L2 | Some older Android | Rarely seen today |
| L3 | Desktop Chrome/Firefox, older Android | Software DRM only; studios may cap at 540p for licensed content |

For a ticket-gated event platform serving your own content, L3 is entirely acceptable.

### Minimum Viable Multi-DRM Coverage

| DRM System | Covers |
|------------|--------|
| **Widevine** | Chrome, Firefox, Edge, Opera on Windows/Mac/Linux/Android |
| **FairPlay** | All of Apple: Safari on macOS, every browser on iOS/iPadOS |
| **PlayReady** | Adds hardware security on Windows Edge; Smart TVs (Samsung, LG, Xbox) |

> **Rule of thumb: If the device is made by Apple → FairPlay. Everything else → Widevine.**
> PlayReady is a bonus layer for Windows hardware security and Smart TV platforms.
