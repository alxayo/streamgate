import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Load the monorepo root env file so Prisma CLI can read DATABASE_URL.
loadEnv({ path: path.resolve(process.cwd(), '../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});