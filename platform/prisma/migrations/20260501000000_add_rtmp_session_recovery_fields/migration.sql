-- Add RTMP session recovery metadata for StreamGate-only emergency unlocks.
ALTER TABLE "RtmpSession" ADD COLUMN "connId" TEXT;
ALTER TABLE "RtmpSession" ADD COLUMN "streamKey" TEXT;
ALTER TABLE "RtmpSession" ADD COLUMN "endedReason" TEXT;
ALTER TABLE "RtmpSession" ADD COLUMN "endedBy" TEXT;
ALTER TABLE "RtmpSession" ADD COLUMN "endedMetadata" TEXT;

CREATE INDEX "RtmpSession_connId_idx" ON "RtmpSession"("connId");
CREATE INDEX "RtmpSession_streamKey_idx" ON "RtmpSession"("streamKey");
