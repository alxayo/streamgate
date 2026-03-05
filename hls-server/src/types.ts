import type { PlaybackTokenClaims } from '@streaming/shared';
import type { Request } from 'express';

/** Extended request with decoded JWT claims */
export interface AuthenticatedRequest extends Request {
  claims?: PlaybackTokenClaims;
}
