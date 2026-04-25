-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "streamType" TEXT NOT NULL DEFAULT 'LIVE',
    "streamUrl" TEXT,
    "posterUrl" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "accessWindowHours" INTEGER NOT NULL DEFAULT 48,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "autoPurge" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Event" ("accessWindowHours", "createdAt", "description", "endsAt", "id", "isActive", "isArchived", "posterUrl", "startsAt", "streamType", "streamUrl", "title", "updatedAt") SELECT "accessWindowHours", "createdAt", "description", "endsAt", "id", "isActive", "isArchived", "posterUrl", "startsAt", "streamType", "streamUrl", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
