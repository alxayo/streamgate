-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Creator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPendingApproval" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Creator" ("createdAt", "displayName", "email", "id", "isActive", "isEmailVerified", "lastLoginAt", "passwordHash", "totpEnabled", "totpSecret", "updatedAt") SELECT "createdAt", "displayName", "email", "id", "isActive", "isEmailVerified", "lastLoginAt", "passwordHash", "totpEnabled", "totpSecret", "updatedAt" FROM "Creator";
DROP TABLE "Creator";
ALTER TABLE "new_Creator" RENAME TO "Creator";
CREATE UNIQUE INDEX "Creator_email_key" ON "Creator"("email");
CREATE INDEX "Creator_email_idx" ON "Creator"("email");
CREATE TABLE "new_SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "transcoderDefaults" TEXT NOT NULL,
    "playerDefaults" TEXT NOT NULL,
    "creatorRegistrationMode" TEXT NOT NULL DEFAULT 'open',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SystemSettings" ("id", "playerDefaults", "transcoderDefaults", "updatedAt") SELECT "id", "playerDefaults", "transcoderDefaults", "updatedAt" FROM "SystemSettings";
DROP TABLE "SystemSettings";
ALTER TABLE "new_SystemSettings" RENAME TO "SystemSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
