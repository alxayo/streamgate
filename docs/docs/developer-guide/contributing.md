---
sidebar_position: 9
title: Contributing
---

# Contributing

This guide covers development setup, code conventions, and workflow for contributing to StreamGate.

## Development Setup

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+ (comes with Node.js)
- **Git**

### First-Time Setup

```bash
# 1. Clone the repository
git clone <repository-url>
cd VideoPlayer

# 2. Install all dependencies (npm workspaces)
npm install

# 3. Set up the Platform App database
cd platform
cp .env.example .env           # Create environment file
npx prisma migrate dev         # Initialize SQLite + apply migrations

# 4. Start the Platform App
npm run dev                    # → http://localhost:3000

# 5. Start the HLS Server (new terminal)
cd hls-server
npm run dev                    # → http://localhost:4000
```

### Verify the Setup

1. Open `http://localhost:3000` — you should see the Viewer Portal
2. Open `http://localhost:3000/admin` — you should see the Admin login
3. Open `http://localhost:4000/health` — you should see `{ "status": "ok", ... }`

## Code Conventions

### TypeScript Strict Mode

All code uses TypeScript with strict mode enabled. Ensure:

- No `any` types without explicit justification
- All function parameters and return types are typed
- Use types from `@streaming/shared` for cross-service contracts

### API Route Patterns

Next.js App Router API routes follow this structure:

```typescript
// platform/src/app/api/example/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // 1. Rate limiting (if applicable)
    // 2. Input validation
    // 3. Business logic
    // 4. Return success response
    return NextResponse.json({ data: result });
  } catch (error) {
    // 5. Return error response
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
```

Conventions:
- Return `{ data: T }` on success, `{ error: string }` on failure
- Use semantic HTTP status codes (see [API Reference](./api-reference.md))
- Validate all input at the boundary
- Use vague error messages for security-sensitive endpoints

### Component Patterns

React components follow these conventions:

- **shadcn/ui** components live in `platform/src/components/ui/`
- **Custom components** are organized by domain: `player/`, `admin/`, `viewer/`
- Use **Tailwind CSS** for styling
- Use **Lucide** for icons
- Use **Framer Motion** for animations (200–300ms ease-out for controls, 100ms for hover states)

```tsx
// Example component structure
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause } from 'lucide-react';
import { motion } from 'framer-motion';

interface PlayPauseButtonProps {
  isPlaying: boolean;
  onToggle: () => void;
}

export function PlayPauseButton({ isPlaying, onToggle }: PlayPauseButtonProps) {
  return (
    <motion.div whileHover={{ scale: 1.1 }} transition={{ duration: 0.1 }}>
      <Button onClick={onToggle} variant="ghost" size="icon">
        {isPlaying ? <Pause /> : <Play />}
      </Button>
    </motion.div>
  );
}
```

### JWT Patterns

- Use the `jose` library for all JWT operations
- Platform App: `mintPlaybackToken()` and `verifyPlaybackToken()` in `platform/src/lib/jwt.ts`
- HLS Server: `JwtVerifier` class in `hls-server/src/services/jwt-verifier.ts`
- Shared: Use types and constants from `@streaming/shared`
- Never store raw access codes in browser memory after initial validation

### Shared Library Changes

When modifying `shared/src/`:

1. Export new symbols from `shared/src/index.ts`
2. Run `cd shared && npm run typecheck` to validate
3. Both services pick up changes immediately (no build step)

## Testing

### Running Tests

```bash
# Run all tests for a service
cd platform && npm test
cd hls-server && npm test

# Run tests in watch mode
npm test -- --watch

# Run a specific test file
npm test -- path/to/test.test.ts
```

### Linting

```bash
# Run ESLint + Prettier checks
cd platform && npm run lint
cd hls-server && npm run lint
```

### Pre-Commit Checklist

Before committing, ensure:

- [ ] `npm test` passes in both `platform/` and `hls-server/`
- [ ] `npm run lint` passes in both services
- [ ] `cd shared && npm run typecheck` passes
- [ ] No `console.log` statements left in production code
- [ ] No hardcoded secrets or credentials
- [ ] New environment variables are documented

## Project Structure Overview

```
VideoPlayer/
├── platform/              # Next.js Platform App
│   ├── prisma/            #   Database schema + migrations
│   └── src/
│       ├── app/           #   Pages + API routes (App Router)
│       ├── components/    #   React components (ui, player, admin, viewer)
│       ├── hooks/         #   Custom React hooks
│       └── lib/           #   Utility modules
├── hls-server/            # Express HLS Media Server
│   └── src/
│       ├── middleware/    #   Express middleware
│       ├── routes/       #   Route handlers
│       ├── services/     #   Business logic services
│       └── utils/        #   Utility functions
├── shared/                # Shared TypeScript library
│   └── src/
│       ├── types.ts      #   Type definitions
│       ├── constants.ts  #   Constants (from PDR)
│       ├── jwt.ts        #   JWT utilities
│       └── validation.ts #   Input validation
├── docs/                  # Docusaurus documentation site
├── scripts/               # Build/deployment scripts
├── docker-compose.yml     # Docker Compose config
├── package.json           # Root workspace config
└── tsconfig.base.json     # Shared TypeScript config
```

## PR Guidelines

### PR Structure

- Keep PRs focused on a single feature or fix
- Include a clear description of what changed and why
- Reference related issues or tasks in the description
- Include test changes alongside code changes

### Review Checklist

Reviewers should verify:

- [ ] Code follows TypeScript strict mode conventions
- [ ] API responses use consistent `{ data }` / `{ error }` shape
- [ ] Security-sensitive endpoints use vague error messages
- [ ] Rate limiting is applied where required
- [ ] Shared types are used for cross-service contracts
- [ ] No secrets or credentials in the code
- [ ] Database schema changes include a migration

## Security Non-Negotiables

These rules must **never** be violated, regardless of the feature:

1. **Never expose raw `.m3u8` URLs** without JWT protection
2. **One token = one active viewer** at a time (single-device enforcement)
3. **Rate-limit all public endpoints**: token validation (5/min/IP), JWT refresh (12/hr/token), admin login (10/min/IP)
4. **Admin password** stored as bcrypt hash — never plaintext
5. **All token codes alphanumeric only** — reject non-alphanumeric input server-side
6. **HLS server error responses must be vague** — no internal state leakage
7. **Never store raw access codes in browser** after initial validation (use JWT `sub` claim)
8. **Token codes generated with `crypto.randomBytes()`** — never `Math.random()`
9. **Strip `__token` query parameter from all logs** to prevent JWT leakage
10. **HTTPS required in production** — JWTs in plaintext headers are unacceptable

:::danger
If a PR violates any of these non-negotiables, it must be rejected regardless of other merits. These rules exist to protect viewer access and prevent unauthorized stream access.
:::
