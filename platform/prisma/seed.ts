import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';

const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db');
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

const TOKEN_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateCode(): string {
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += TOKEN_CHARSET[bytes[i] % TOKEN_CHARSET.length];
  }
  return code;
}

async function seed() {
  console.log('Seeding database...\n');

  const now = new Date();

  // Event 1: Upcoming (starts in 2 hours)
  const event1 = await prisma.event.create({
    data: {
      title: 'Annual Tech Conference 2026',
      description: 'Join us for the biggest tech event of the year featuring keynotes, workshops, and networking.',
      startsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      accessWindowHours: 48,
      isActive: true,
    },
  });

  // Event 2: Currently live
  const event2 = await prisma.event.create({
    data: {
      title: 'Live Product Launch',
      description: 'Watch the live unveiling of our newest product line.',
      startsAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      accessWindowHours: 24,
      isActive: true,
    },
  });

  // Event 3: Ended but within access window
  const event3 = await prisma.event.create({
    data: {
      title: 'Developer Workshop: Building Scalable APIs',
      description: 'A hands-on workshop covering API design, testing, and deployment best practices.',
      startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() - 20 * 60 * 60 * 1000),
      accessWindowHours: 48,
      isActive: true,
    },
  });

  // Generate tokens for each event
  for (const event of [event1, event2, event3]) {
    const expiresAt = new Date(
      event.endsAt.getTime() + event.accessWindowHours * 60 * 60 * 1000,
    );

    const tokenData = [];

    // 5 unused tokens
    for (let i = 0; i < 5; i++) {
      tokenData.push({
        code: generateCode(),
        eventId: event.id,
        label: `Seed token ${i + 1}`,
        expiresAt,
      });
    }

    // 3 redeemed tokens
    for (let i = 0; i < 3; i++) {
      tokenData.push({
        code: generateCode(),
        eventId: event.id,
        label: `Redeemed ${i + 1}`,
        redeemedAt: new Date(now.getTime() - 30 * 60 * 1000),
        redeemedIp: '192.168.1.' + (100 + i),
        expiresAt,
      });
    }

    // 1 revoked token
    tokenData.push({
      code: generateCode(),
      eventId: event.id,
      label: 'Revoked token',
      isRevoked: true,
      revokedAt: new Date(now.getTime() - 60 * 60 * 1000),
      expiresAt,
    });

    // 1 expired token (set expiresAt in the past)
    tokenData.push({
      code: generateCode(),
      eventId: event.id,
      label: 'Expired token',
      expiresAt: new Date(now.getTime() - 1000),
    });

    await prisma.token.createMany({ data: tokenData });
  }

  // Print summary
  const events = await prisma.event.findMany({ include: { _count: { select: { tokens: true } } } });
  console.log('Created events:');
  for (const event of events) {
    console.log(`  - ${event.title} (${event._count.tokens} tokens)`);
  }

  // Print some usable token codes
  const unusedTokens = await prisma.token.findMany({
    where: { redeemedAt: null, isRevoked: false, expiresAt: { gt: now } },
    take: 3,
    include: { event: { select: { title: true } } },
  });
  console.log('\nSample access codes you can use:');
  for (const token of unusedTokens) {
    console.log(`  ${token.code}  →  ${token.event.title}`);
  }
}

seed()
  .then(() => {
    console.log('\nDone!');
  })
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
