-- AlterTable
ALTER TABLE "Event" ADD COLUMN "playerConfig" TEXT;
ALTER TABLE "Event" ADD COLUMN "transcoderConfig" TEXT;

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "transcoderDefaults" TEXT NOT NULL,
    "playerDefaults" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
