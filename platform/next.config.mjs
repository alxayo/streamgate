import { networkInterfaces } from 'os';

/** Collect all non-internal IPv4 addresses so LAN access just works in dev. */
function getLanOrigins() {
  const origins = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        origins.push(net.address);
      }
    }
  }
  return origins;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  allowedDevOrigins: getLanOrigins(),
  // Allow large video file uploads (up to 6 GB) for VOD transcoding.
  // Without this, Next.js buffers only the first 10 MB and formData() parsing
  // fails with "Invalid multipart form data" for anything larger.
  proxyClientMaxBodySize: '6gb',
};

export default nextConfig;
