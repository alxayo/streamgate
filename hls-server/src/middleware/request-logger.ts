import type { Request, Response, NextFunction } from 'express';
import { hashForLog } from '../utils/hash.js';

/**
 * Structured JSON request logging middleware (PDR §6.6).
 * Strips __token from logged paths. Hashes token codes.
 */
export function createRequestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    res.on('finish', () => {
      // Strip __token query param from logged path
      let logPath = req.originalUrl;
      if (logPath.includes('__token=')) {
        logPath = logPath.replace(/[?&]__token=[^&]*/g, '').replace(/\?$/, '');
      }

      // Extract and hash token code from JWT claims if available
      const claims = (req as { claims?: { sub?: string } }).claims;
      const tokenCodeHash = claims?.sub ? hashForLog(claims.sub) : undefined;

      const logEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: logPath,
        status: res.statusCode,
        responseTimeMs: Date.now() - startTime,
        clientIp: req.ip || req.headers['x-forwarded-for'] || 'unknown',
        ...(tokenCodeHash && { tokenCode: tokenCodeHash }),
      };

      // Use appropriate log level based on status code
      if (res.statusCode >= 500) {
        console.error(JSON.stringify(logEntry));
      } else if (res.statusCode >= 400) {
        console.warn(JSON.stringify(logEntry));
      } else {
        console.log(JSON.stringify(logEntry));
      }
    });

    next();
  };
}
