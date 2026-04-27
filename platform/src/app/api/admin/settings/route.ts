/**
 * Admin API: System Settings CRUD
 * ================================
 * GET  /api/admin/settings — Returns current system-wide defaults
 * PUT  /api/admin/settings — Updates system-wide defaults
 *
 * Protected by session cookie auth via Next.js middleware.
 * The middleware matcher ['/admin/:path*', '/api/admin/:path*'] covers this route.
 *
 * System settings are stored as a singleton row in the SystemSettings table.
 * The upsert bootstrap guard ensures the row always exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getSystemDefaults,
  validateTranscoderConfig,
  validatePlayerConfig,
} from '@/lib/stream-config';
import { checkPermission } from '@/lib/require-permission';
import { getRegistrationMode, type RegistrationMode } from '@/lib/registration-mode';

/**
 * GET /api/admin/settings
 * Returns the current system-wide transcoder and player defaults.
 * Uses the bootstrap guard — always returns data, even if DB was never seeded.
 */
export async function GET() {
  const denied = await checkPermission('dashboard:view');
  if (denied) return denied;

  const defaults = await getSystemDefaults();
  const registrationMode = await getRegistrationMode();

  return NextResponse.json({
    data: {
      transcoder: defaults.transcoder,
      player: defaults.player,
      creatorRegistrationMode: registrationMode,
    },
  });
}

/**
 * PUT /api/admin/settings
 * Updates system-wide defaults. Accepts partial updates — you can update
 * just the transcoder config, just the player config, or both.
 *
 * Request body: { transcoder?: TranscoderConfig, player?: PlayerConfig }
 * Both fields are validated before saving. Invalid configs return 400.
 */
export async function PUT(request: NextRequest) {
  const denied = await checkPermission('settings:manage');
  if (denied) return denied;

  const body = await request.json();
  const { transcoder, player, creatorRegistrationMode } = body;

  // Validate transcoder config if provided
  if (transcoder !== undefined) {
    const result = validateTranscoderConfig(transcoder);
    if (!result.valid) {
      return NextResponse.json(
        { error: 'Invalid transcoder config', details: result.errors },
        { status: 400 },
      );
    }
  }

  // Validate player config if provided
  if (player !== undefined) {
    const result = validatePlayerConfig(player);
    if (!result.valid) {
      return NextResponse.json(
        { error: 'Invalid player config', details: result.errors },
        { status: 400 },
      );
    }
  }

  // Validate registration mode if provided
  const validModes: RegistrationMode[] = ['open', 'approval', 'disabled'];
  if (creatorRegistrationMode !== undefined && !validModes.includes(creatorRegistrationMode)) {
    return NextResponse.json(
      { error: 'Invalid registration mode. Must be: open, approval, or disabled.' },
      { status: 400 },
    );
  }

  // Get current values so we can merge partial updates
  const current = await getSystemDefaults();

  const updatedTranscoder = transcoder ?? current.transcoder;
  const updatedPlayer = player ?? current.player;

  // Upsert to handle both first-time creation and updates
  const settings = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      transcoderDefaults: JSON.stringify(updatedTranscoder),
      playerDefaults: JSON.stringify(updatedPlayer),
      ...(creatorRegistrationMode && { creatorRegistrationMode }),
    },
    update: {
      transcoderDefaults: JSON.stringify(updatedTranscoder),
      playerDefaults: JSON.stringify(updatedPlayer),
      ...(creatorRegistrationMode && { creatorRegistrationMode }),
    },
  });

  return NextResponse.json({
    data: {
      transcoder: JSON.parse(settings.transcoderDefaults),
      player: JSON.parse(settings.playerDefaults),
      creatorRegistrationMode: settings.creatorRegistrationMode,
    },
  });
}
