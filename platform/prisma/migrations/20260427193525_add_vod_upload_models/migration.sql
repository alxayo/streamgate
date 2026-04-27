-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "blobPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "errorMessage" TEXT,
    "duration" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Upload_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TranscodeJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadId" TEXT NOT NULL,
    "codec" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER,
    "aciContainerGroup" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TranscodeJob_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "transcoderDefaults" TEXT NOT NULL,
    "playerDefaults" TEXT NOT NULL,
    "creatorRegistrationMode" TEXT NOT NULL DEFAULT 'open',
    "maxUploadSizeBytes" BIGINT NOT NULL DEFAULT 5368709120,
    "enabledCodecs" TEXT NOT NULL DEFAULT '["h264"]',
    "vodRenditions" TEXT NOT NULL DEFAULT '{"h264":[{"label":"1080p","width":1920,"height":1080,"videoBitrate":"5000k","audioBitrate":"192k"},{"label":"720p","width":1280,"height":720,"videoBitrate":"2500k","audioBitrate":"128k"},{"label":"480p","width":854,"height":480,"videoBitrate":"1000k","audioBitrate":"96k"}]}',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemSettings" ("creatorRegistrationMode", "id", "playerDefaults", "transcoderDefaults", "updatedAt") SELECT "creatorRegistrationMode", "id", "playerDefaults", "transcoderDefaults", "updatedAt" FROM "SystemSettings";
DROP TABLE "SystemSettings";
ALTER TABLE "new_SystemSettings" RENAME TO "SystemSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Upload_eventId_key" ON "Upload"("eventId");

-- CreateIndex
CREATE INDEX "Upload_eventId_idx" ON "Upload"("eventId");

-- CreateIndex
CREATE INDEX "Upload_status_idx" ON "Upload"("status");

-- CreateIndex
CREATE INDEX "TranscodeJob_uploadId_idx" ON "TranscodeJob"("uploadId");

-- CreateIndex
CREATE INDEX "TranscodeJob_status_idx" ON "TranscodeJob"("status");

-- CreateIndex
CREATE INDEX "TranscodeJob_codec_idx" ON "TranscodeJob"("codec");
