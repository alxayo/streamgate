function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig() {
  const streamRoot = process.env.STREAM_ROOT || null;
  const upstreamOrigin = process.env.UPSTREAM_ORIGIN || null;

  // PDR §6.3: must have at least one content source
  if (!streamRoot && !upstreamOrigin) {
    throw new Error(
      'Configuration error: At least one of STREAM_ROOT or UPSTREAM_ORIGIN must be set.',
    );
  }

  return {
    port: parseInt(process.env.PORT || '4000', 10),
    playbackSigningSecret: requireEnv('PLAYBACK_SIGNING_SECRET'),
    platformAppUrl: requireEnv('PLATFORM_APP_URL'),
    internalApiKey: requireEnv('INTERNAL_API_KEY'),
    streamRoot,
    upstreamOrigin,
    segmentCacheRoot: process.env.SEGMENT_CACHE_ROOT || (streamRoot ? `${streamRoot}/cache` : null),
    segmentCacheMaxSizeGb: parseFloat(process.env.SEGMENT_CACHE_MAX_SIZE_GB || '50'),
    segmentCacheMaxAgeHours: parseInt(process.env.SEGMENT_CACHE_MAX_AGE_HOURS || '72', 10),
    revocationPollIntervalMs: parseInt(process.env.REVOCATION_POLL_INTERVAL_MS || '30000', 10),
    corsAllowedOrigin: requireEnv('CORS_ALLOWED_ORIGIN'),
    streamKeyPrefix: process.env.STREAM_KEY_PREFIX || '',
  };
}

export type ServerConfig = ReturnType<typeof loadConfig>;
