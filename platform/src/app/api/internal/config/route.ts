import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CONFIG_KEYS, type ConfigKey, getConfigValue, getConfigValues } from '@/lib/system-config';

const allowedKeys = new Set<string>(Object.values(CONFIG_KEYS));

async function validateApiKey(headerValue: string | null): Promise<boolean> {
  if (!headerValue) return false;
  const expectedKey = await getConfigValue(prisma, CONFIG_KEYS.INTERNAL_API_KEY);
  return !!expectedKey && headerValue === expectedKey;
}

// GET /api/internal/config — Fetch shared config values for internal services
export async function GET(request: NextRequest) {
  const apiKey = request.headers.get('x-internal-api-key');
  if (!(await validateApiKey(apiKey))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const keysParam = searchParams.get('keys');

  if (!keysParam) {
    return NextResponse.json({ error: 'keys parameter is required' }, { status: 400 });
  }

  const requestedKeys = keysParam.split(',').map((k) => k.trim()).filter(Boolean);

  if (requestedKeys.length === 0) {
    return NextResponse.json({ error: 'keys parameter is required' }, { status: 400 });
  }

  // Only allow known config keys
  const invalidKeys = requestedKeys.filter((k) => !allowedKeys.has(k));
  if (invalidKeys.length > 0) {
    return NextResponse.json(
      { error: `Unknown config keys: ${invalidKeys.join(', ')}` },
      { status: 400 },
    );
  }

  const values = await getConfigValues(prisma, requestedKeys as ConfigKey[]);

  return NextResponse.json({ data: values });
}
