// =========================================================================
// POST /api/creator/register — Creator Registration
// =========================================================================
// Creates a new creator account + default channel in a single transaction.
// Behavior depends on the system's creatorRegistrationMode setting:
//   - "open": Auto-login after registration (default)
//   - "approval": Account created but inactive until admin approves
//   - "disabled": Registration rejected
//
// Rate limited: 5 registrations per hour per IP.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { getCreatorSession } from '@/lib/creator-session';
import { RateLimiter } from '@/lib/rate-limiter';
import { prisma } from '@/lib/prisma';
import { getRegistrationMode } from '@/lib/registration-mode';

const registerLimiter = new RateLimiter({ maxRequests: 5, windowMs: 3_600_000 });

/** Generate a URL-safe slug from a display name */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const { allowed, retryAfterMs } = registerLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many registration attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 3600000) / 1000)) } },
    );
  }

  // Check registration mode
  const mode = await getRegistrationMode();
  if (mode === 'disabled') {
    return NextResponse.json(
      { error: 'Registration is currently closed.' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const { email, password, displayName } = body as {
    email?: string;
    password?: string;
    displayName?: string;
  };

  // Validate inputs
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length < 2) {
    return NextResponse.json({ error: 'Display name must be at least 2 characters' }, { status: 400 });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = displayName.trim();

  // Check for existing creator with same email
  const existing = await prisma.creator.findUnique({ where: { email: trimmedEmail } });
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
  }

  // Hash password (12 salt rounds, same as admin)
  const passwordHash = await bcrypt.hash(password, 12);

  // Generate unique slug for default channel
  let slug = slugify(trimmedName);
  if (!slug) slug = 'channel';
  const slugExists = await prisma.channel.findUnique({ where: { slug } });
  if (slugExists) {
    slug = `${slug}-${Date.now().toString(36)}`;
  }

  const isApprovalMode = mode === 'approval';

  // Create creator + default channel in transaction
  const result = await prisma.$transaction(async (tx) => {
    const creator = await tx.creator.create({
      data: {
        email: trimmedEmail,
        passwordHash,
        displayName: trimmedName,
        isActive: !isApprovalMode,
        isPendingApproval: isApprovalMode,
      },
    });

    const channel = await tx.channel.create({
      data: {
        creatorId: creator.id,
        name: `${trimmedName}'s Channel`,
        slug,
        isActive: !isApprovalMode,
      },
    });

    return { creator, channel };
  });

  // In approval mode, don't create a session — tell the user to wait
  if (isApprovalMode) {
    return NextResponse.json({
      data: {
        creatorId: result.creator.id,
        pendingApproval: true,
        message: 'Your account has been created and is pending admin approval.',
      },
    }, { status: 201 });
  }

  // Create session (auto-login) — open mode
  const session = await getCreatorSession();
  session.creatorId = result.creator.id;
  session.email = result.creator.email;
  session.channelId = result.channel.id;
  session.channelSlug = result.channel.slug;
  session.displayName = result.creator.displayName;
  session.twoFactorVerified = true; // No 2FA required yet
  await session.save();

  return NextResponse.json({
    data: {
      creatorId: result.creator.id,
      channelId: result.channel.id,
      channelSlug: result.channel.slug,
    },
  }, { status: 201 });
}
