/*
  Warnings:

  - A unique constraint covering the columns `[rtmpStreamKeyHash]` on the table `Event` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[rtmpToken]` on the table `Event` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Event" ADD COLUMN "rtmpStreamKeyHash" TEXT;
ALTER TABLE "Event" ADD COLUMN "rtmpToken" TEXT;
ALTER TABLE "Event" ADD COLUMN "rtmpTokenExpiresAt" DATETIME;

-- CreateTable
CREATE TABLE "RtmpSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "rtmpPublisherIp" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RtmpSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RtmpSession_eventId_idx" ON "RtmpSession"("eventId");

-- CreateIndex
CREATE INDEX "RtmpSession_endedAt_idx" ON "RtmpSession"("endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_rtmpStreamKeyHash_key" ON "Event"("rtmpStreamKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Event_rtmpToken_key" ON "Event"("rtmpToken");
