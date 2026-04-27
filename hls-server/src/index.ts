import 'dotenv/config';
import express from 'express';
import { loadConfig, type ServerConfig } from './config.js';
import { fetchRemoteConfig } from './services/config-fetcher.js';
import { JwtVerifier } from './services/jwt-verifier.js';
import { RevocationCache } from './services/revocation-cache.js';
import { RevocationSyncService } from './services/revocation-sync.js';
import { ContentResolver } from './services/content-resolver.js';
import { UpstreamProxy } from './services/upstream-proxy.js';
import { SegmentCache } from './services/segment-cache.js';
import { InflightDeduplicator } from './services/inflight-dedup.js';
import { CacheCleanupService } from './services/cache-cleanup.js';
import { createJwtAuthMiddleware } from './middleware/jwt-auth.js';
import { createCorsMiddleware } from './middleware/cors-config.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { createStreamRoutes } from './routes/streams.js';
import { createHealthRoute } from './routes/health.js';
import { createAdminCacheRoute } from './routes/admin-cache.js';
import { createAdminFinalizeRoute } from './routes/admin-finalize.js';

let app: express.Express;
let config: ServerConfig;

async function main() {
  // Fetch missing config from platform API before loading config
  await fetchRemoteConfig();

  config = loadConfig();
  app = express();

  // Services
  const jwtVerifier = new JwtVerifier(config);
  const revocationCache = new RevocationCache();
  const syncService = new RevocationSyncService(revocationCache, config);
  const contentResolver = new ContentResolver(config);
  const upstreamProxy = config.upstreamOrigin ? new UpstreamProxy(config) : null;
  const segmentCache = new SegmentCache(config);
  const inflightDedup = new InflightDeduplicator();
  const cacheCleanup = new CacheCleanupService(config);

  // Middleware
  app.use(createCorsMiddleware(config));
  app.use(createRequestLogger());

  // Routes (no auth)
  app.use(createHealthRoute(revocationCache, syncService, segmentCache));

  // Routes (API key auth)
  app.use(createAdminCacheRoute(segmentCache, upstreamProxy, config));
  app.use(createAdminFinalizeRoute(upstreamProxy, config));

  // Routes (JWT auth)
  const jwtAuth = createJwtAuthMiddleware(jwtVerifier, revocationCache);
  app.use('/streams', jwtAuth);
  app.use(createStreamRoutes(contentResolver, upstreamProxy, segmentCache, inflightDedup, config));

  // Error handler (must be last)
  app.use(createErrorHandler());

  // Start services
  syncService.start();
  cacheCleanup.start();

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`HLS Media Server listening on 0.0.0.0:${config.port}`);
    console.log(`Content mode: ${contentResolver.mode}`);
  });

  // Graceful shutdown
  function shutdown() {
    console.log('Shutting down...');
    syncService.stop();
    cacheCleanup.stop();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export { app, config };
