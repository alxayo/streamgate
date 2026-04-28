-- Rename aciContainerGroup to executionName in TranscodeJob table.
-- This is a non-destructive rename that preserves existing data.
ALTER TABLE "TranscodeJob" RENAME COLUMN "aciContainerGroup" TO "executionName";
