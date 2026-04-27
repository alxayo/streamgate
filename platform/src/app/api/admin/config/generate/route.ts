import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { CONFIG_KEYS, type ConfigKey } from '@/lib/system-config';

const validKeys = new Set(Object.values(CONFIG_KEYS));

function maskValue(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
}

// POST /api/admin/config/generate — generate a new random value for a key
export async function POST(request: NextRequest) {
  const denied = await checkPermission('settings:manage');
  if (denied) return denied;

  const body = await request.json();
  const { key } = body;

  if (!key || typeof key !== 'string' || !validKeys.has(key as ConfigKey)) {
    return NextResponse.json({ error: 'Invalid config key' }, { status: 400 });
  }

  const generated = crypto.randomBytes(32).toString('base64url');

  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: generated },
    create: { key, value: generated },
  });

  return NextResponse.json({ data: { key, maskedValue: maskValue(generated) } });
}
