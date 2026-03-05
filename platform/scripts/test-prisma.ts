import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'node:path';

async function main() {
  const dbPath = path.resolve(process.cwd(), 'prisma', 'dev.db');
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });

  const count = await prisma.event.count();
  console.log('Event count:', count);

  const events = await prisma.event.findMany({ select: { title: true } });
  console.log('Events:', events.map((e: { title: string }) => e.title));

  console.log('Success!');
}

main().catch(console.error);
