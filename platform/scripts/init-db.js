const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
console.log('Creating database at:', dbPath);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS Event (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    streamUrl TEXT,
    posterUrl TEXT,
    startsAt DATETIME NOT NULL,
    endsAt DATETIME NOT NULL,
    accessWindowHours INTEGER NOT NULL DEFAULT 48,
    isActive BOOLEAN NOT NULL DEFAULT 1,
    isArchived BOOLEAN NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Token (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    eventId TEXT NOT NULL,
    label TEXT,
    isRevoked BOOLEAN NOT NULL DEFAULT 0,
    revokedAt DATETIME,
    redeemedAt DATETIME,
    redeemedIp TEXT,
    expiresAt DATETIME NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (eventId) REFERENCES Event(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_eventId ON Token(eventId);
CREATE INDEX IF NOT EXISTS idx_token_code ON Token(code);
CREATE INDEX IF NOT EXISTS idx_token_isRevoked ON Token(isRevoked);

CREATE TABLE IF NOT EXISTS ActiveSession (
    id TEXT PRIMARY KEY,
    tokenId TEXT NOT NULL,
    sessionId TEXT NOT NULL UNIQUE,
    lastHeartbeat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clientIp TEXT NOT NULL,
    userAgent TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tokenId) REFERENCES Token(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_tokenId ON ActiveSession(tokenId);
CREATE INDEX IF NOT EXISTS idx_session_sessionId ON ActiveSession(sessionId);
CREATE INDEX IF NOT EXISTS idx_session_lastHeartbeat ON ActiveSession(lastHeartbeat);
`);

console.log('Database tables created successfully!');
db.close();
