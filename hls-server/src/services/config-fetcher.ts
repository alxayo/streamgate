/**
 * Fetches shared config from the platform API if env vars are not set.
 * Called once at startup before loadConfig(). Results are cached in
 * process.env so the rest of the codebase doesn't need to change.
 */
export async function fetchRemoteConfig(): Promise<void> {
  const platformUrl = process.env.PLATFORM_APP_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!platformUrl || !apiKey) {
    console.log('[config] No PLATFORM_APP_URL or INTERNAL_API_KEY — using env vars only');
    return;
  }

  const neededKeys: string[] = [];
  if (!process.env.PLAYBACK_SIGNING_SECRET) neededKeys.push('PLAYBACK_SIGNING_SECRET');

  if (neededKeys.length === 0) {
    console.log('[config] All config keys present in env — skipping remote fetch');
    return;
  }

  try {
    const url = `${platformUrl}/api/internal/config?keys=${neededKeys.join(',')}`;
    const response = await fetch(url, {
      headers: { 'X-Internal-Api-Key': apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(
        `[config] Failed to fetch remote config: ${response.status} ${response.statusText}`,
      );
      return;
    }

    const body = await response.json();
    if (body.data) {
      for (const [key, value] of Object.entries(body.data)) {
        if (value && typeof value === 'string') {
          process.env[key] = value;
          console.log(`[config] Loaded ${key} from platform API`);
        }
      }
    }
  } catch (err) {
    console.error(
      '[config] Failed to fetch remote config:',
      err instanceof Error ? err.message : err,
    );
    // Non-fatal — continue with whatever env vars are set
  }
}
