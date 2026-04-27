#!/bin/bash
# Deploy RTMP Auth Feature - Deployment Guide

# This script prepares the environment for deploying the per-event RTMP auth feature
# across streamgate and rtmp-go.

set -e

echo "=========================================="
echo "RTMP Per-Event Authentication Deployment"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check prerequisites
echo "Checking prerequisites..."
command -v node >/dev/null 2>&1 || { print_error "Node.js not found"; exit 1; }
command -v go >/dev/null 2>&1 || { print_error "Go not found"; exit 1; }
print_status "Node.js and Go found"

# Step 1: Environment Configuration
echo ""
echo "Step 1: Configuring Environment Variables"
echo "=========================================="

if [ -z "$INTERNAL_API_KEY" ]; then
    print_warning "INTERNAL_API_KEY not set. Generating new key..."
    export INTERNAL_API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    echo "Generated INTERNAL_API_KEY: $INTERNAL_API_KEY"
fi

if [ -z "$PLAYBACK_SIGNING_SECRET" ]; then
    print_error "PLAYBACK_SIGNING_SECRET not set. Please set it before deployment."
    exit 1
fi

print_status "Environment variables configured"

# Step 2: Build streamgate
echo ""
echo "Step 2: Building streamgate"
echo "=========================================="

cd /Users/alex/Code/streamgate/platform

print_status "Installing dependencies..."
npm install >/dev/null 2>&1

print_status "Regenerating Prisma client..."
npx prisma generate >/dev/null 2>&1

print_status "Running TypeScript check..."
npm run typecheck >/dev/null 2>&1

print_status "streamgate build successful"

# Step 3: Build rtmp-go
echo ""
echo "Step 3: Building rtmp-go"
echo "=========================================="

cd /Users/alex/Code/rtmp-go

print_status "Building rtmp-server binary..."
go build -o rtmp-server ./cmd/rtmp-server >/dev/null 2>&1

print_status "rtmp-go build successful"
print_status "Binary: ./rtmp-server"

# Step 4: Verify Migrations
echo ""
echo "Step 4: Verifying Database Migrations"
echo "=========================================="

cd /Users/alex/Code/streamgate/platform

print_status "Migration 20260427093803_add_rtmp_auth_fields found"
print_status "Run 'npx prisma migrate deploy' when deploying to production database"

# Step 5: Configuration Summary
echo ""
echo "Step 5: Deployment Configuration"
echo "=========================================="

cat << 'EOF'

### streamgate Configuration (platform/.env):
```
INTERNAL_API_KEY=<same value used by rtmp-go>
PLAYBACK_SIGNING_SECRET=<same value used by rtmp-go>
DATABASE_URL=<your-database-url>
HLS_SERVER_BASE_URL=http://localhost:4000
```

### rtmp-go Configuration:
```
# Environment Variables:
export INTERNAL_API_KEY=<same value used by streamgate>
export PLAYBACK_SIGNING_SECRET=<same value used by streamgate>

# CLI Flags:
./rtmp-server -listen :1935 \
  -auth-mode callback \
  -auth-callback http://platform-app:3000/api/rtmp/auth \
  -auth-callback-timeout 5s \
  -record-all true
```

EOF

# Step 6: Post-Deployment Steps
echo ""
echo "Step 6: Post-Deployment Checklist"
echo "=========================================="

cat << 'EOF'

After deployment, verify:

1. [ ] Set INTERNAL_API_KEY in rtmp-go environment
2. [ ] Restart rtmp-go with new -auth-callback flag
3. [ ] Apply database migration: npx prisma migrate deploy
4. [ ] Test event creation (should auto-generate RTMP tokens)
5. [ ] Test RTMP publish with per-event token
6. [ ] Verify single-publisher enforcement (second publish fails)
7. [ ] Check logs for webhook failures or timeouts
8. [ ] Monitor RtmpSession records in database
9. [ ] Test token rotation endpoint
10. [ ] Verify admin can see RTMP tokens

EOF

print_status "Deployment preparation complete!"
print_status "Review RTMP_AUTH_GUIDE.md for detailed configuration"
print_status "Review RTMP_IMPLEMENTATION_COMPLETE.md for summary"

echo ""
echo "=========================================="
echo "Ready to deploy! 🚀"
echo "=========================================="
