import type { Request, Response, NextFunction } from 'express';
import type { JwtVerifier } from '../services/jwt-verifier.js';
import type { RevocationCache } from '../services/revocation-cache';
import type { AuthenticatedRequest } from '../types.js';

/**
 * JWT authentication middleware (PDR §5.5, §6.2).
 * Validates JWT on every streaming request.
 * Supports Authorization header (preferred) and __token query param (Safari fallback).
 */
export function createJwtAuthMiddleware(
  jwtVerifier: JwtVerifier,
  revocationCache: RevocationCache,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Step 1: Extract JWT from Authorization header or __token query param
      let token: string | undefined;

      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }

      // Safari fallback: __token query parameter (PDR §6.2)
      if (!token && typeof req.query.__token === 'string') {
        token = req.query.__token;
      }

      if (!token) {
        res.status(401).json({ error: 'Authorization required' });
        return;
      }

      // Step 2-4: Verify signature, expiry, and path prefix
      // Use req.baseUrl + req.path to get the full path (Express strips mountpoint from req.path)
      const fullPath = req.baseUrl + req.path;
      const claims = await jwtVerifier.verify(token, fullPath);

      // Step 5: Handle probe JWTs (HEAD only, PDR §10.1)
      if (claims.probe && req.method !== 'HEAD') {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Step 6: Check revocation cache (PDR §5.5 rule 5)
      if (claims.sub && revocationCache.isRevoked(claims.sub)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Attach claims to request
      (req as AuthenticatedRequest).claims = claims;
      next();
    } catch {
      res.status(403).json({ error: 'Access denied' });
    }
  };
}
