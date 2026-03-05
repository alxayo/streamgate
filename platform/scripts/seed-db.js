const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const TOKEN_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateCode() {
  const bytes = crypto.randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += TOKEN_CHARSET[bytes[i] % TOKEN_CHARSET.length];
  }
  return code;
}

function uuid() {
  return crypto.randomUUID();
}

const now = new Date();

// Clear existing data
db.exec('DELETE FROM ActiveSession');
db.exec('DELETE FROM Token');
db.exec('DELETE FROM Event');

// Event 1: Upcoming (starts in 2 hours)
const event1Id = uuid();
const event1Start = new Date(now.getTime() + 2 * 60 * 60 * 1000);
const event1End = new Date(now.getTime() + 6 * 60 * 60 * 1000);

// Event 2: Currently live (started 1 hour ago)
const event2Id = uuid();
const event2Start = new Date(now.getTime() - 1 * 60 * 60 * 1000);
const event2End = new Date(now.getTime() + 2 * 60 * 60 * 1000);

// Event 3: Ended but within access window
const event3Id = uuid();
const event3Start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const event3End = new Date(now.getTime() - 20 * 60 * 60 * 1000);

const insertEvent = db.prepare(`
  INSERT INTO Event (id, title, description, startsAt, endsAt, accessWindowHours, isActive, isArchived, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
`);

insertEvent.run(event1Id, 'Annual Tech Conference 2026',
  'Join us for the biggest tech event of the year featuring keynotes, workshops, and networking.',
  event1Start.toISOString(), event1End.toISOString(), 48, now.toISOString(), now.toISOString());

insertEvent.run(event2Id, 'Live Product Launch',
  'Watch the live unveiling of our newest product line.',
  event2Start.toISOString(), event2End.toISOString(), 24, now.toISOString(), now.toISOString());

insertEvent.run(event3Id, 'Developer Workshop: Building Scalable APIs',
  'A hands-on workshop covering API design, testing, and deployment best practices.',
  event3Start.toISOString(), event3End.toISOString(), 48, now.toISOString(), now.toISOString());

const insertToken = db.prepare(`
  INSERT INTO Token (id, code, eventId, label, isRevoked, revokedAt, redeemedAt, redeemedIp, expiresAt, createdAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const events = [
  { id: event1Id, title: 'Annual Tech Conference 2026', endsAt: event1End, windowHours: 48 },
  { id: event2Id, title: 'Live Product Launch', endsAt: event2End, windowHours: 24 },
  { id: event3Id, title: 'Developer Workshop', endsAt: event3End, windowHours: 48 },
];

const usableCodes = [];

for (const event of events) {
  const expiresAt = new Date(event.endsAt.getTime() + event.windowHours * 60 * 60 * 1000);

  // 5 unused tokens
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    insertToken.run(uuid(), code, event.id, `Seed token ${i + 1}`, 0, null, null, null, expiresAt.toISOString(), now.toISOString());
    if (i === 0) usableCodes.push({ code, event: event.title });
  }

  // 3 redeemed tokens
  for (let i = 0; i < 3; i++) {
    const code = generateCode();
    const redeemedAt = new Date(now.getTime() - 30 * 60 * 1000);
    insertToken.run(uuid(), code, event.id, `Redeemed ${i + 1}`, 0, null, redeemedAt.toISOString(), `192.168.1.${100 + i}`, expiresAt.toISOString(), now.toISOString());
  }

  // 1 revoked token
  const revokedCode = generateCode();
  const revokedAt = new Date(now.getTime() - 60 * 60 * 1000);
  insertToken.run(uuid(), revokedCode, event.id, 'Revoked token', 1, revokedAt.toISOString(), null, null, expiresAt.toISOString(), now.toISOString());

  // 1 expired token
  const expiredCode = generateCode();
  const pastExpiry = new Date(now.getTime() - 1000);
  insertToken.run(uuid(), expiredCode, event.id, 'Expired token', 0, null, null, null, pastExpiry.toISOString(), now.toISOString());
}

console.log('\nDatabase seeded successfully!\n');
console.log('Created 3 events with 10 tokens each.\n');
console.log('=== Sample access codes you can use ===\n');
for (const { code, event } of usableCodes) {
  console.log(`  ${code}  →  ${event}`);
}
console.log('\n=== Admin login ===\n');
console.log('  URL:      http://localhost:3000/admin');
console.log('  Password: admin123');
console.log('');

db.close();
