import cors from 'cors';
import { CORS_MAX_AGE_SECONDS } from '@streaming/shared';
import type { ServerConfig } from '../config.js';

export function createCorsMiddleware(config: ServerConfig) {
  const origins = config.corsAllowedOrigin.split(',').map((o) => o.trim());
  return cors({
    origin: origins.length === 1 ? origins[0] : origins,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Range'],
    maxAge: CORS_MAX_AGE_SECONDS,
  });
}
 