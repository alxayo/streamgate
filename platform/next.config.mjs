import { networkInterfaces } from 'os';

/** Collect all non-internal IPv4 addresses so LAN access just works in dev. */
function getLanOrigins() {
  const origins = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        origins.push(`http://${net.address}:3000`);
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
};

export default nextConfig;
