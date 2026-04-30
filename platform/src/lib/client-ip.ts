import { NextRequest } from 'next/server';

// Read the browser/client IP as reported by Azure Container Apps or another proxy.
// The first X-Forwarded-For value is the original client; later values are proxies.
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';

  // X-Real-IP is a common fallback header when X-Forwarded-For is not present.
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}