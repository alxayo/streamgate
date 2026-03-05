import express from 'express';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(config.port, () => {
  console.log(`HLS Media Server listening on port ${config.port}`);
  console.log(`Content mode: ${config.streamRoot && config.upstreamOrigin ? 'hybrid' : config.streamRoot ? 'local' : 'proxy'}`);
});

export { app, config };
