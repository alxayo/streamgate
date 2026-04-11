import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '../platform/src/generated/prisma/client.js';

const TOKEN_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateCode(): string {
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += TOKEN_CHARSET[bytes[i] % TOKEN_CHARSET.length];
  }
  return code;
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..');
  const dbPath = path.resolve(workspaceRoot, 'platform', 'dev.db');
  const streamsRoot = path.resolve(workspaceRoot, 'streams');

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });

  const title = parseArg('title') || 'Sample VOD Stream';
  const description = parseArg('description') || 'Local HLS VOD stream for testing playback.';
  const accessWindowHours = Number.parseInt(parseArg('access-window-hours') || '168', 10);

  if (!Number.isFinite(accessWindowHours) || accessWindowHours < 1) {
    throw new Error('access-window-hours must be a positive integer');
  }

  const now = new Date();
  const startsAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() - 60 * 60 * 1000);
  const expiresAt = new Date(endsAt.getTime() + accessWindowHours * 60 * 60 * 1000);

  const event = await prisma.event.create({
    data: {
      title,
      description,
      startsAt,
      endsAt,
      accessWindowHours,
      isActive: true,
    },
  });

  const tokenCode = generateCode();

  await prisma.token.create({
    data: {
      code: tokenCode,
      eventId: event.id,
      label: 'VOD access token',
      expiresAt,
    },
  });

  const vodDir = path.resolve(streamsRoot, event.id);
  await fs.mkdir(vodDir, { recursive: true });

  await fs.writeFile(
    path.resolve(vodDir, 'README.txt'),
    [
      `Place your VOD HLS files in this directory:`,
      '',
      `Required manifest path:`,
      `  stream.m3u8`,
      '',
      `Segment examples:`,
      `  segment_000.ts`,
      `  segment_001.ts`,
      '',
      `Playlist references must use relative paths (e.g. segment_000.ts).`,
    ].join('\n'),
    'utf-8',
  );

  console.log('\nVOD created successfully\n');
  console.log(`Event ID: ${event.id}`);
  console.log(`Token code: ${tokenCode}`);
  console.log(`VOD folder: ${vodDir}`);
  console.log(`Playback URL: http://localhost:3000`);
  console.log(`HLS URL (protected): http://localhost:4000/streams/${event.id}/stream.m3u8`);
  console.log('');
  console.log('Next step: copy your stream.m3u8 and .ts files into the VOD folder.');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Failed to create VOD:', error instanceof Error ? error.message : error);
  process.exit(1);
});