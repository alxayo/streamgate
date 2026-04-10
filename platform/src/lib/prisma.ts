import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'node:path';

const globalForPrisma = globalThis as unknown as { prisma: InstanceType<typeof PrismaClient> };

function createPrismaClient() {
  const rawUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const rawPath = rawUrl.replace(/^file:/, '');
  const isRelativePath = !path.isAbsolute(rawPath);
  const platformDir = process.cwd().endsWith('/platform')
    ? process.cwd()
    : path.resolve(process.cwd(), 'platform');
  const resolvedPath = isRelativePath ? path.resolve(platformDir, rawPath) : rawPath;
  const adapter = new PrismaBetterSqlite3({ url: `file:${resolvedPath}` });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
