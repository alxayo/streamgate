-- Stores the per-event IP/CIDR rules used by RTMP PLAY authorization.
-- A rule belongs to exactly one Event and is deleted when that Event is deleted.
CREATE TABLE "RtmpPlayAllowlistEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RtmpPlayAllowlistEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Prevent duplicate normalized rules for the same event.
CREATE UNIQUE INDEX "RtmpPlayAllowlistEntry_eventId_cidr_key" ON "RtmpPlayAllowlistEntry"("eventId", "cidr");

-- Keep event detail pages fast when listing rules for one event.
CREATE INDEX "RtmpPlayAllowlistEntry_eventId_idx" ON "RtmpPlayAllowlistEntry"("eventId");