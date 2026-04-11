#!/usr/bin/env node
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../platform/src/generated/prisma/client.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

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

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..');
  const dbPath = path.resolve(workspaceRoot, 'platform', 'dev.db');
  const streamsRoot = path.resolve(workspaceRoot, 'streams');

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });

  let title = parseArg('title');
  let description = parseArg('description');
  let accessWindowHours = parseArg('access-window-hours');
  let tokenCount = parseArg('tokens');
  let durationStr = parseArg('duration');

  if (!title) title = await prompt('Event title: ');
  if (!description) description = await prompt('Event description: ');
  if (!accessWindowHours) accessWindowHours = await prompt('Access window (hours): ');
  if (!tokenCount) tokenCount = await prompt('Number of tokens to generate: ');
  if (!durationStr) durationStr = await prompt('Event duration in hours [2]: ');

  const accessWindow = Number.parseInt(accessWindowHours || '48', 10);
  const numTokens = Number.parseInt(tokenCount || '1', 10);
  const durationHours = Number.parseFloat(durationStr || '2');

  if (!Number.isFinite(accessWindow) || accessWindow < 1) {
    throw new Error('access-window-hours must be a positive integer');
  }
  if (!Number.isFinite(numTokens) || numTokens < 1) {
    throw new Error('tokens must be a positive integer');
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error('duration must be a positive number');
  }

  const now = new Date();
  const startsAt = now;
  const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
  const expiresAt = new Date(endsAt.getTime() + accessWindow * 60 * 60 * 1000);

  const event = await prisma.event.create({
    data: {
      title,
      description,
      startsAt,
      endsAt,
      accessWindowHours: accessWindow,
      isActive: true,
    },
  });

  const tokenData = Array.from({ length: numTokens }, (_, i) => ({
    code: generateCode(),
    label: `Access token ${i + 1}`,
  }));

  const tokens = await prisma.$transaction(
    tokenData.map((t) =>
      prisma.token.create({
        data: {
          code: t.code,
          eventId: event.id,
          label: t.label,
          expiresAt,
        },
      }),
    ),
  );

  const eventDir = path.resolve(streamsRoot, event.id);
  await fs.mkdir(eventDir, { recursive: true });

  await fs.writeFile(
    path.resolve(eventDir, 'README.txt'),
    [
      `Place your HLS files in this directory:`,
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

  const eventInfo = {
    eventId: event.id,
    title: event.title,
    description: event.description,
    tokens: tokens.map((t) => ({ code: t.code, expiresAt: t.expiresAt })),
    eventDir,
    playbackUrl: `http://localhost:3000`,
    hlsUrl: `http://localhost:4000/streams/${event.id}/stream.m3u8`,
  };

  console.log('\n📋 Event Created Successfully\n');
  console.log(`  Event ID:    ${event.id}`);
  console.log(`  Title:       ${event.title}`);
  console.log(`  Starts:      ${event.startsAt.toISOString()}`);
  console.log(`  Ends:        ${event.endsAt.toISOString()}`);
  console.log(`  Stream Dir:  ${eventDir}`);
  console.log(`  Playback:    http://localhost:3000`);
  console.log(`  HLS URL:     http://localhost:4000/streams/${event.id}/stream.m3u8`);
  console.log('');
  console.log('  Tokens:');
  for (const t of tokens) {
    console.log(`    ${t.code}  (expires ${t.expiresAt.toISOString()})`);
  }
  console.log('');
  console.log(`  Event info saved to: ${path.resolve(eventDir, 'event-info.json')}`);
  console.log('');
  console.log('  Next step: place your stream.m3u8 and .ts files into the stream directory,');
  console.log('  or use rtmp-ingest.ts for automated live streaming.');

  await fs.writeFile(
    path.resolve(eventDir, 'event-info.json'),
    JSON.stringify(eventInfo, null, 2),
    'utf-8',
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Failed to create event:', error instanceof Error ? error.message : error);
  process.exit(1);
});
