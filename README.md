# Ticket-Gated Video Streaming Platform

A ticket-gated HTML5 video streaming platform with two independently deployable services sharing JWT-based playback authentication.

## 📚 Documentation

- **[GETTING_STARTED.md](GETTING_STARTED.md)** — **Start here!** Complete step-by-step guide to set up and run the system locally
- **[PDR.md](PDR.md)** — Full product specification, data model, API contracts, and deployment topologies
- **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** — Development task breakdown and work streams
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Production deployment guide (Docker, cloud platforms)

## Architecture

| Service | Framework | Directory | Port |
|---------|-----------|-----------|------|
| **Platform App** | Next.js 14+ (TypeScript) | `platform/` | 3000 |
| **HLS Media Server** | Express.js (TypeScript) | `hls-server/` | 4000 |
| **Shared** | TypeScript types/constants | `shared/` | — |

## Prerequisites

- **Node.js** 20+ (see `.nvmrc`)
- **npm** 10+

## Quick Start

> **👉 For detailed setup instructions, see [GETTING_STARTED.md](GETTING_STARTED.md)**

### TL;DR

```bash
# 1. Install dependencies
npm install

# 2. Generate secrets
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Configure environment
cp .env.example .env
# Edit .env with generated secrets (PLAYBACK_SIGNING_SECRET, INTERNAL_API_KEY, ADMIN_SESSION_SECRET)
# Set ADMIN_PASSWORD_HASH for the initial super_admin user (npm run hash-password)

# 4. Initialize database
cd platform
set -a
source ../.env
set +a
npx prisma migrate dev --name init
npx prisma generate
npx prisma db seed        # Optional: sample data

# 5. Start services (in separate terminals)
cd platform && set -a && source ../.env && set +a && PORT=3000 npm run dev      # Terminal 1: Port 3000
cd hls-server && set -a && source ../.env && set +a && npm run dev    # Terminal 2: Port 4000
```

**Access the application:**
- Viewer Portal: http://localhost:3000
- Admin Console: http://localhost:3000/admin (multi-user with 2FA)
- HLS Server Health: http://localhost:4000/health

## Project Structure

```
├── shared/               # Shared types, constants, and utilities
│   └── src/
│       ├── types.ts      # Domain types (JWT claims, API responses)
│       ├── constants.ts  # Shared constants (rate limits, timeouts)
│       ├── jwt.ts        # JWT utility functions
│       └── validation.ts # Input validation helpers
├── platform/             # Next.js Platform App
│   ├── prisma/           # Database schema and migrations
│   └── src/
│       ├── app/          # Next.js App Router (pages + API routes)
│       ├── components/   # React components (UI, player, admin, viewer)
│       ├── hooks/        # Custom React hooks
│       └── lib/          # Server-side utilities (JWT, auth, DB)
├── hls-server/           # Express.js HLS Media Server
│   └── src/
│       ├── middleware/    # JWT auth, CORS, logging
│       ├── routes/       # Stream serving, health, admin cache
│       ├── services/     # Revocation cache, upstream proxy, cache mgmt
│       └── utils/        # Path safety, hashing
```

## Environment Variables

See `.env.example` for a complete reference with documentation.

## Development Workflow

- Both services share the `@streaming/shared` workspace package
- Changes to `shared/` are immediately available in both services (no build step)
- Use `npx prisma studio` to inspect the database visually
- HLS test streams should be placed in `./streams/<eventId>/`
hls-server/streams/<eventId>/`

## Need Help?

- **Setup issues?** See [GETTING_STARTED.md](GETTING_STARTED.md) — Comprehensive troubleshooting section
- **API questions?** See [GETTING_STARTED.md#api-reference](GETTING_STARTED.md#api-reference) — Complete API documentation
- **Deployment?** See [DEPLOYMENT.md](DEPLOYMENT.md) — Docker & cloud deployment guides
- **Architecture details?** See [PDR.md](PDR.md) — Full product specification