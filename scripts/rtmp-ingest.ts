#!/usr/bin/env node
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../platform/src/generated/prisma/client.js';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
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

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const workspaceRoot = path.resolve(__dirname, '..');
  const dbPath = path.resolve(workspaceRoot, 'platform', 'prisma', 'dev.db');

  const streamsRoot = hasFlag('docker')
    ? path.resolve(workspaceRoot, 'streams')
    : path.resolve(workspaceRoot, 'hls-server', 'streams');

  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });

  // Parse CLI args or prompt interactively
  let title = parseArg('title');
  let description = parseArg('description');
  let accessWindowHoursStr = parseArg('access-window-hours');
  let tokenCountStr = parseArg('tokens');
  let rtmpUrl = parseArg('rtmp-url');
  let durationStr = parseArg('duration');

  if (!title) title = await prompt('Event title: ');
  if (!description) description = await prompt('Event description: ');
  if (!accessWindowHoursStr) accessWindowHoursStr = await prompt('Access window (hours) [48]: ');
  if (!tokenCountStr) tokenCountStr = await prompt('Number of tokens [1]: ');
  if (!rtmpUrl) rtmpUrl = await prompt('RTMP source URL [rtmp://localhost:1935/live/stream]: ');
  if (!durationStr) durationStr = await prompt('Stream duration in hours [2]: ');

  const accessWindowHours = Number.parseInt(accessWindowHoursStr || '48', 10);
  const numTokens = Number.parseInt(tokenCountStr || '1', 10);
  const durationHours = Number.parseFloat(durationStr || '2');
  rtmpUrl = rtmpUrl || 'rtmp://localhost:1935/live/stream';

  if (!Number.isFinite(accessWindowHours) || accessWindowHours < 1) {
    throw new Error('access-window-hours must be a positive integer');
  }
  if (!Number.isFinite(numTokens) || numTokens < 1) {
    throw new Error('tokens must be a positive integer');
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error('duration must be a positive number');
  }

  // Create event in DB
  const now = new Date();
  const startsAt = now;
  const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
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

  // Generate N tokens
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

  const tokenInfo = tokens.map((t) => ({ code: t.code, expiresAt: t.expiresAt }));

  // Create stream directory
  const streamDir = path.resolve(streamsRoot, event.id);
  await fs.mkdir(streamDir, { recursive: true });

  // Write event-info.json
  const eventInfo = {
    eventId: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    accessWindowHours,
    tokens: tokenInfo,
    streamDir,
    rtmpUrl,
    playbackUrl: 'http://localhost:3000',
    hlsUrl: `http://localhost:4000/streams/${event.id}/stream.m3u8`,
  };

  await fs.writeFile(
    path.resolve(streamDir, 'event-info.json'),
    JSON.stringify(eventInfo, null, 2),
    'utf-8',
  );

  // Print summary
  console.log('\n🎬 RTMP Ingest Event Created\n');
  console.log(`  Event ID:    ${event.id}`);
  console.log(`  Title:       ${event.title}`);
  console.log(`  Starts:      ${event.startsAt.toISOString()}`);
  console.log(`  Ends:        ${event.endsAt.toISOString()}`);
  console.log(`  RTMP Source:  ${rtmpUrl}`);
  console.log(`  Stream Dir:  ${streamDir}`);
  console.log(`  Playback:    http://localhost:3000`);
  console.log(`  HLS URL:     http://localhost:4000/streams/${event.id}/stream.m3u8`);
  console.log('');
  console.log('  Tokens:');
  for (const t of tokenInfo) {
    console.log(`    ${t.code}  (expires ${t.expiresAt.toISOString()})`);
  }
  console.log('');
  console.log(`  Event info saved to: ${path.resolve(streamDir, 'event-info.json')}`);
  console.log('');

  await prisma.$disconnect();

  // Build FFmpeg command
  const hlsPath = path.resolve(streamDir, 'stream.m3u8');
  const segmentPath = path.resolve(streamDir, 'segment-%03d.ts');

  const ffmpegArgs = [
    '-i', rtmpUrl,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-c:a', 'aac', '-b:a', '128k',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', segmentPath,
    hlsPath,
  ];

  console.log(`▶ Launching FFmpeg:\n  ffmpeg ${ffmpegArgs.join(' ')}\n`);

  const ffmpegProc: ChildProcess = spawn('ffmpeg', ffmpegArgs, { stdio: 'inherit' });

  // Graceful shutdown on SIGINT
  const cleanup = () => {
    console.log('\n⏹ Stopping FFmpeg...');
    if (ffmpegProc.pid && !ffmpegProc.killed) {
      ffmpegProc.kill('SIGINT');
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  ffmpegProc.on('exit', (code) => {
    process.removeListener('SIGINT', cleanup);
    process.removeListener('SIGTERM', cleanup);
    console.log(`FFmpeg exited with code ${code}`);
    process.exit(code ?? 0);
  });

  ffmpegProc.on('error', (err) => {
    console.error(`Failed to start FFmpeg: ${err.message}`);
    console.error('Make sure FFmpeg is installed and available on your PATH.');
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('Failed to start RTMP ingest:', error instanceof Error ? error.message : error);
  process.exit(1);
});
