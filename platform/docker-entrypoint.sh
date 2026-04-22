#!/bin/sh
set -e

# SQLite doesn't work reliably on Azure Files (SMB) due to locking issues.
# Strategy: copy DB from persistent mount to local disk, run locally, sync back.
MOUNT_DB="/data/streamgate.db"
LOCAL_DB="/tmp/streamgate.db"
export DATABASE_URL="file:${LOCAL_DB}"

# Copy existing DB from mount to local (if it exists)
if [ -f "$MOUNT_DB" ]; then
  echo "Copying database from persistent storage to local disk..."
  cp "$MOUNT_DB" "$LOCAL_DB"
  # Also copy WAL/SHM if present
  [ -f "${MOUNT_DB}-wal" ] && cp "${MOUNT_DB}-wal" "${LOCAL_DB}-wal"
  [ -f "${MOUNT_DB}-shm" ] && cp "${MOUNT_DB}-shm" "${LOCAL_DB}-shm"
fi

echo "Running Prisma migrations..."
npx prisma migrate deploy --schema=./prisma/schema.prisma

# Sync DB back to persistent mount after migrations
echo "Syncing database to persistent storage..."
cp "$LOCAL_DB" "$MOUNT_DB" 2>/dev/null || true

# Background sync: copy local DB to mount every 60 seconds
(
  while true; do
    sleep 60
    cp "$LOCAL_DB" "$MOUNT_DB" 2>/dev/null || true
  done
) &
SYNC_PID=$!

# Clean up sync process on exit and do final sync
trap 'cp "$LOCAL_DB" "$MOUNT_DB" 2>/dev/null || true; kill $SYNC_PID 2>/dev/null' EXIT

echo "Starting Next.js server..."
exec npm start
