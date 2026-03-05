import crypto from 'node:crypto';
import { TOKEN_CODE_LENGTH, TOKEN_CODE_CHARSET } from '@streaming/shared';

/**
 * Generate a cryptographically random base62 token code (PDR §5.2).
 * 12 characters = ~71 bits of entropy.
 */
export function generateTokenCode(): string {
  const bytes = crypto.randomBytes(TOKEN_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < TOKEN_CODE_LENGTH; i++) {
    code += TOKEN_CODE_CHARSET[bytes[i] % TOKEN_CODE_CHARSET.length];
  }
  return code;
}

/**
 * Generate multiple unique token codes.
 * Uses a Set to guarantee uniqueness within the batch.
 */
export function generateTokenCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateTokenCode());
  }
  return Array.from(codes);
}
