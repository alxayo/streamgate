import cors from 'cors';
import { CORS_MAX_AGE_SECONDS } from '@streaming/shared';
import type { ServerConfig } from '../config.js';

export function createCorsMiddleware(config: ServerConfig) {
  return cors({
    origin: config.corsAllowedOrigin,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Range'],
    maxAge: CORS_MAX_AGE_SECONDS,
  });
}
