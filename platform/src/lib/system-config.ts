import { PrismaClient } from '@/generated/prisma/client';

// Known shared config keys
export const CONFIG_KEYS = {
  INTERNAL_API_KEY: 'INTERNAL_API_KEY',
  PLAYBACK_SIGNING_SECRET: 'PLAYBACK_SIGNING_SECRET',
  RTMP_AUTH_TOKEN: 'RTMP_AUTH_TOKEN',
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

/**
 * Get a config value with env var override.
 * Resolution: ENV var → DB → null
 */
export async function getConfigValue(
  prisma: PrismaClient,
  key: ConfigKey,
): Promise<string | null> {
  // Env var always wins (backward compat + on-prem)
  const envValue = process.env[key];
  if (envValue) return envValue;

  // Fall back to DB
  const record = await prisma.systemConfig.findUnique({ where: { key } });
  return record?.value ?? null;
}

/**
 * Get a config value, throwing if not found anywhere.
 */
export async function requireConfigValue(
  prisma: PrismaClient,
  key: ConfigKey,
): Promise<string> {
  const value = await getConfigValue(prisma, key);
  if (!value) {
    throw new Error(
      `Missing required config: ${key}. Set it as an environment variable or in the SystemConfig table.`,
    );
  }
  return value;
}

/**
 * Set a config value in the DB (upsert).
 */
export async function setConfigValue(
  prisma: PrismaClient,
  key: ConfigKey,
  value: string,
): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/**
 * Get multiple config values at once.
 * Returns a map of key → value (env var override applied per key).
 */
export async function getConfigValues(
  prisma: PrismaClient,
  keys: ConfigKey[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};

  // Check env vars first
  const keysToFetch: ConfigKey[] = [];
  for (const key of keys) {
    const envValue = process.env[key];
    if (envValue) {
      result[key] = envValue;
    } else {
      keysToFetch.push(key);
    }
  }

  // Batch fetch remaining from DB
  if (keysToFetch.length > 0) {
    const records = await prisma.systemConfig.findMany({
      where: { key: { in: keysToFetch } },
    });
    const dbMap = new Map(records.map((r) => [r.key, r.value]));
    for (const key of keysToFetch) {
      result[key] = dbMap.get(key) ?? null;
    }
  }

  return result;
}
