-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "streamUrl" TEXT,
    "posterUrl" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "accessWindowHours" INTEGER NOT NULL DEFAULT 48,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" DATETIME,
    "redeemedAt" DATETIME,
    "redeemedIp" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Token_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActiveSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "lastHeartbeat" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientIp" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActiveSession_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Token_code_key" ON "Token"("code");

-- CreateIndex
CREATE INDEX "Token_eventId_idx" ON "Token"("eventId");

-- CreateIndex
CREATE INDEX "Token_code_idx" ON "Token"("code");

-- CreateIndex
CREATE INDEX "Token_isRevoked_idx" ON "Token"("isRevoked");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveSession_sessionId_key" ON "ActiveSession"("sessionId");

-- CreateIndex
CREATE INDEX "ActiveSession_tokenId_idx" ON "ActiveSession"("tokenId");

-- CreateIndex
CREATE INDEX "ActiveSession_sessionId_idx" ON "ActiveSession"("sessionId");

-- CreateIndex
CREATE INDEX "ActiveSession_lastHeartbeat_idx" ON "ActiveSession"("lastHeartbeat");
