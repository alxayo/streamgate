import express from 'express';
import { loadConfig } from './config.js';
import { JwtVerifier } from './services/jwt-verifier.js';
import { RevocationCache } from './services/revocation-cache.js';
import { RevocationSyncService } from './services/revocation-sync.js';
import { ContentResolver } from './services/content-resolver.js';
import { UpstreamProxy } from './services/upstream-proxy.js';
import { SegmentCache } from './services/segment-cache.js';
import { InflightDeduplicator } from './services/inflight-dedup.js';
import { createJwtAuthMiddleware } from './middleware/jwt-auth.js';
import { createCorsMiddleware } from './middleware/cors-config.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { createStreamRoutes } from './routes/streams.js';
import { createHealthRoute } from './routes/health.js';
import { createAdminCacheRoute } from './routes/admin-cache.js';

const config = loadConfig();
const app = express();

// Services
const jwtVerifier = new JwtVerifier(config);
const revocationCache = new RevocationCache();
const syncService = new RevocationSyncService(revocationCache, config);
const contentResolver = new ContentResolver(config);
const upstreamProxy = config.upstreamOrigin ? new UpstreamProxy(config) : null;
const segmentCache = new SegmentCache(config);
const inflightDedup = new InflightDeduplicator();

// Middleware
app.use(createCorsMiddleware(config));
app.use(createRequestLogger());

// Routes (no auth)
app.use(createHealthRoute(revocationCache, syncService, segmentCache));

// Routes (API key auth)
app.use(createAdminCacheRoute(segmentCache, config));

// Routes (JWT auth)
const jwtAuth = createJwtAuthMiddleware(jwtVerifier, revocationCache);
app.use('/streams', jwtAuth);
app.use(createStreamRoutes(contentResolver, upstreamProxy, segmentCache, inflightDedup));

// Start services
syncService.start();

const server = app.listen(config.port, () => {
  console.log(`HLS Media Server listening on port ${config.port}`);
  console.log(`Content mode: ${contentResolver.mode}`);
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  syncService.stop();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, config };
