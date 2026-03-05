import { jwtVerify } from 'jose';
import type { PlaybackTokenClaims } from '@streaming/shared';
import { JWT_ALGORITHM, isPathAllowed } from '@streaming/shared';
import type { ServerConfig } from '../config.js';

export class JwtVerifier {
  private readonly secret: Uint8Array;

  constructor(config: ServerConfig) {
    this.secret = new TextEncoder().encode(config.playbackSigningSecret);
  }

  /**
   * Verify JWT and validate path access (PDR §5.4).
   * Returns decoded claims if valid, or throws with a generic error.
   */
  async verify(token: string, requestPath: string): Promise<PlaybackTokenClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      algorithms: [JWT_ALGORITHM],
    });
    const claims = payload as unknown as PlaybackTokenClaims;

    // Path prefix match (PDR §5.4 rule 4)
    if (!isPathAllowed(requestPath, claims.sp)) {
      throw new Error('Access denied');
    }

    return claims;
  }
}
