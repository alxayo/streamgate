import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { CONFIG_KEYS, type ConfigKey } from '@/lib/system-config';

const validKeys = new Set(Object.values(CONFIG_KEYS));

/** Mask a secret value: show first 4 + last 4 chars, mask the rest. */
function maskValue(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4);
}

// GET /api/admin/config — list all config entries with masked values
export async function GET() {
  const denied = await checkPermission('settings:manage');
  if (denied) return denied;

  const allKeys = Object.values(CONFIG_KEYS);
  const records = await prisma.systemConfig.findMany({
    where: { key: { in: allKeys } },
  });
  const dbMap = new Map(records.map((r) => [r.key, r]));

  const entries = allKeys.map((key) => {
    const record = dbMap.get(key);
    const envValue = process.env[key];
    return {
      key,
      maskedValue: record ? maskValue(record.value) : envValue ? maskValue(envValue) : null,
      source: envValue ? 'env' : record ? 'database' : 'not_set',
      updatedAt: record?.updatedAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ data: entries });
}

// PUT /api/admin/config — update a config value
export async function PUT(request: NextRequest) {
  const denied = await checkPermission('settings:manage');
  if (denied) return denied;

  const body = await request.json();
  const { key, value } = body;

  if (!key || typeof key !== 'string' || !validKeys.has(key as ConfigKey)) {
    return NextResponse.json({ error: 'Invalid config key' }, { status: 400 });
  }
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return NextResponse.json({ error: 'Value is required' }, { status: 400 });
  }

  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: value.trim() },
    create: { key, value: value.trim() },
  });

  return NextResponse.json({ data: { key, maskedValue: maskValue(value.trim()) } });
}
