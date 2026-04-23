#!/usr/bin/env bash
# ============================================================================
# Deploy StreamGate to Azure Container Apps (into existing rtmp-go environment)
# ============================================================================
# Usage:
#   ./deploy.sh                                              # interactive
#   ADMIN_PASSWORD_HASH='$2b$12$...' ./deploy.sh             # non-interactive
#
# Environment variables:
#   RESOURCE_GROUP            — resource group (default: rg-rtmpgo)
#   LOCATION                  — Azure region (default: eastus2)
#   PLAYBACK_SIGNING_SECRET   — HMAC secret (auto-generated if empty)
#   INTERNAL_API_KEY          — internal API key (auto-generated if empty)
#   ADMIN_PASSWORD_HASH       — bcrypt hash of admin password (required)
#   HLS_SERVER_BASE_URL       — override HLS server public URL (optional)
#   CORS_ALLOWED_ORIGIN       — override CORS origin (optional)
#   ADMIN_ALLOWED_IP          — IP allowed to access /admin (auto-detected if empty)
#
# Prerequisites:
#   - Azure CLI logged in (az login)
#   - rtmp-go deployed to the resource group (provides ACR, Storage, ACA Env)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STREAMGATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Configuration ---
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-rtmpgo}"
LOCATION="${LOCATION:-eastus2}"

echo "============================================"
echo "  StreamGate Azure Deployment"
echo "============================================"
echo "Resource Group:  $RESOURCE_GROUP"
echo "Location:        $LOCATION"
echo "StreamGate Root: $STREAMGATE_ROOT"
echo "============================================"

# --- Verify Azure CLI login ---
if ! az account show &>/dev/null; then
  echo "ERROR: Not logged in to Azure CLI. Run 'az login' first."
  exit 1
fi

# --- Step 1: Verify rtmp-go deployment exists ---
echo ""
echo ">>> Step 1/7: Verifying rtmp-go deployment..."
if ! az group show --name "$RESOURCE_GROUP" &>/dev/null 2>&1; then
  echo "ERROR: Resource group '$RESOURCE_GROUP' does not exist."
  echo "       Deploy rtmp-go first: cd ../rtmp-go/azure && ./deploy.sh"
  exit 1
fi

# Find the most recent deployment matching rtmp-go's pattern
RTMPGO_OUTPUTS=$(az deployment group list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?properties.outputs.rtmpAppName != null] | [0].properties.outputs" \
  --output json 2>/dev/null)

if [ -z "$RTMPGO_OUTPUTS" ] || [ "$RTMPGO_OUTPUTS" = "null" ]; then
  echo "ERROR: No rtmp-go deployment found in resource group '$RESOURCE_GROUP'."
  echo "       Deploy rtmp-go first: cd ../rtmp-go/azure && ./deploy.sh"
  exit 1
fi

# --- Step 2: Discover rtmp-go shared resources ---
echo ""
echo ">>> Step 2/7: Discovering shared infrastructure..."

CONTAINER_ENV_NAME=$(echo "$RTMPGO_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['environmentName']['value'])")
REGISTRY_LOGIN_SERVER=$(echo "$RTMPGO_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['registryLoginServer']['value'])")
ACR_NAME=$(echo "$RTMPGO_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['registryName']['value'])")
STORAGE_ACCOUNT=$(echo "$RTMPGO_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['storageAccountName']['value'])")
IDENTITY_CLIENT_ID=$(echo "$RTMPGO_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['identityClientId']['value'])")
IDENTITY_NAME=$(echo "$RTMPGO_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['identityName']['value'])")

# Get the full identity resource ID
IDENTITY_ID=$(az identity show \
  --name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query 'id' --output tsv)

echo "    Container Env: $CONTAINER_ENV_NAME"
echo "    ACR:           $REGISTRY_LOGIN_SERVER"
echo "    Storage:       $STORAGE_ACCOUNT"
echo "    Identity:      $IDENTITY_NAME"

# --- Step 3: Configure secrets ---
echo ""
echo ">>> Step 3/7: Configuring secrets..."

# Auto-generate PLAYBACK_SIGNING_SECRET if not set
if [ -z "${PLAYBACK_SIGNING_SECRET:-}" ]; then
  PLAYBACK_SIGNING_SECRET=$(openssl rand -hex 32)
  echo "    Generated PLAYBACK_SIGNING_SECRET (save this!):"
  echo "    $PLAYBACK_SIGNING_SECRET"
fi

# Auto-generate INTERNAL_API_KEY if not set
if [ -z "${INTERNAL_API_KEY:-}" ]; then
  INTERNAL_API_KEY=$(openssl rand -base64 24)
  echo "    Generated INTERNAL_API_KEY (save this!):"
  echo "    $INTERNAL_API_KEY"
fi

# ADMIN_PASSWORD_HASH must be provided
if [ -z "${ADMIN_PASSWORD_HASH:-}" ]; then
  echo ""
  echo "    ADMIN_PASSWORD_HASH is required."
  echo "    Generate one with: cd $STREAMGATE_ROOT && npm run hash-password"
  echo ""
  read -rp "    Enter bcrypt hash (starts with \$2b\$): " ADMIN_PASSWORD_HASH
  if [ -z "$ADMIN_PASSWORD_HASH" ]; then
    echo "ERROR: Admin password hash is required."
    exit 1
  fi
fi

echo "    Secrets configured."

# --- Detect admin IP ---
if [ -z "${ADMIN_ALLOWED_IP:-}" ]; then
  ADMIN_ALLOWED_IP=$(curl -s https://ifconfig.me || echo "")
  if [ -n "$ADMIN_ALLOWED_IP" ]; then
    echo "    Auto-detected admin IP: $ADMIN_ALLOWED_IP"
  fi
fi

# --- Step 4: Deploy Bicep infrastructure (first pass — placeholder images) ---
echo ""
echo ">>> Step 4/7: Deploying infrastructure (Bicep — first pass)..."

DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "streamgate" \
  --template-file "$SCRIPT_DIR/infra/main.bicep" \
  --parameters "$SCRIPT_DIR/infra/main.parameters.json" \
  --parameters \
    containerEnvName="$CONTAINER_ENV_NAME" \
    registryLoginServer="$REGISTRY_LOGIN_SERVER" \
    identityId="$IDENTITY_ID" \
    identityClientId="$IDENTITY_CLIENT_ID" \
    storageAccountName="$STORAGE_ACCOUNT" \
    playbackSigningSecret="$PLAYBACK_SIGNING_SECRET" \
    internalApiKey="$INTERNAL_API_KEY" \
    adminPasswordHash="$ADMIN_PASSWORD_HASH" \
    adminAllowedIp="${ADMIN_ALLOWED_IP:-}" \
  --query 'properties.outputs' \
  --output json)

PLATFORM_FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformAppFqdn']['value'])")
HLS_FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsServerFqdn']['value'])")

echo "    Infrastructure deployed."
echo "    Platform: $PLATFORM_FQDN"
echo "    HLS:      $HLS_FQDN"

# --- Step 5: Build & push Docker images using ACR Tasks ---
echo ""
echo ">>> Step 5/7: Building Docker images in ACR..."

echo "    Building streamgate-platform..."
az acr build \
  --registry "$ACR_NAME" \
  --image streamgate-platform:latest \
  --file "$STREAMGATE_ROOT/platform/Dockerfile" \
  "$STREAMGATE_ROOT" \
  --no-logs --output none

echo "    Building streamgate-hls..."
az acr build \
  --registry "$ACR_NAME" \
  --image streamgate-hls:latest \
  --file "$STREAMGATE_ROOT/hls-server/Dockerfile" \
  "$STREAMGATE_ROOT" \
  --no-logs --output none

echo "    Images built and pushed."

# --- Step 6: Redeploy Bicep with real images + resolved URLs ---
echo ""
echo ">>> Step 6/7: Deploying container apps with built images..."

# Use custom URLs if provided, otherwise derive from ACA FQDNs
EFFECTIVE_HLS_BASE_URL="${HLS_SERVER_BASE_URL:-https://${HLS_FQDN}}"
EFFECTIVE_CORS_ORIGIN="${CORS_ALLOWED_ORIGIN:-https://${PLATFORM_FQDN}}"
EFFECTIVE_PLATFORM_APP_URL="https://${PLATFORM_FQDN}"

# Generate a read-only SAS token for upstream blob proxy (1-year expiry)
echo "    Generating SAS token for hls-content blob access..."
UPSTREAM_SAS_TOKEN=$(az storage container generate-sas \
  --account-name "$STORAGE_ACCOUNT" \
  --name hls-content \
  --permissions rl \
  --expiry "$(date -u -v+1y '+%Y-%m-%dT%H:%MZ' 2>/dev/null || date -u -d '+1 year' '+%Y-%m-%dT%H:%MZ')" \
  --https-only \
  -o tsv)
echo "    SAS token generated (expires in 1 year)."

DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "streamgate" \
  --template-file "$SCRIPT_DIR/infra/main.bicep" \
  --parameters "$SCRIPT_DIR/infra/main.parameters.json" \
  --parameters \
    containerEnvName="$CONTAINER_ENV_NAME" \
    registryLoginServer="$REGISTRY_LOGIN_SERVER" \
    identityId="$IDENTITY_ID" \
    identityClientId="$IDENTITY_CLIENT_ID" \
    storageAccountName="$STORAGE_ACCOUNT" \
    playbackSigningSecret="$PLAYBACK_SIGNING_SECRET" \
    internalApiKey="$INTERNAL_API_KEY" \
    adminPasswordHash="$ADMIN_PASSWORD_HASH" \
    platformImage="${REGISTRY_LOGIN_SERVER}/streamgate-platform:latest" \
    hlsServerImage="${REGISTRY_LOGIN_SERVER}/streamgate-hls:latest" \
    hlsServerBaseUrl="$EFFECTIVE_HLS_BASE_URL" \
    corsAllowedOrigin="$EFFECTIVE_CORS_ORIGIN" \
    platformAppUrl="$EFFECTIVE_PLATFORM_APP_URL" \
    upstreamSasToken="$UPSTREAM_SAS_TOKEN" \
    adminAllowedIp="${ADMIN_ALLOWED_IP:-}" \
  --query 'properties.outputs' \
  --output json)

PLATFORM_APP_NAME=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformAppName']['value'])")
HLS_APP_NAME=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsServerAppName']['value'])")
PLATFORM_FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformAppFqdn']['value'])")
HLS_FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsServerFqdn']['value'])")

# --- Step 7: Verify ---
echo ""
echo ">>> Step 7/7: Verifying deployment..."

PLATFORM_STATUS=$(az containerapp show --name "$PLATFORM_APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query 'properties.runningStatus' --output tsv 2>/dev/null || echo "Unknown")
HLS_STATUS=$(az containerapp show --name "$HLS_APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query 'properties.runningStatus' --output tsv 2>/dev/null || echo "Unknown")

echo "    streamgate-platform: $PLATFORM_STATUS"
echo "    streamgate-hls:      $HLS_STATUS"

SUBSCRIPTION=$(az account show --query 'id' --output tsv)

echo ""
echo "============================================"
echo "  StreamGate Deployment Complete!"
echo "============================================"
echo ""
echo "Platform App (viewer portal + admin):"
echo "  https://${PLATFORM_FQDN}"
echo ""
echo "HLS Media Server:"
echo "  https://${HLS_FQDN}"
echo ""
echo "Admin Console:"
echo "  https://${PLATFORM_FQDN}/admin"
echo ""
echo "Health Check:"
echo "  curl https://${HLS_FQDN}/health"
echo ""
echo "--------------------------------------------"
echo "  Secrets (save these!)"
echo "--------------------------------------------"
echo "  PLAYBACK_SIGNING_SECRET=$PLAYBACK_SIGNING_SECRET"
echo "  INTERNAL_API_KEY=$INTERNAL_API_KEY"
echo ""
echo "--------------------------------------------"
echo "  Broadcaster Workflow"
echo "--------------------------------------------"
echo "  1. Log in to admin: https://${PLATFORM_FQDN}/admin"
echo "  2. Create a new event → note the event UUID"
echo "  3. Tell broadcaster to publish:"
echo "     ffmpeg -re -i video.mp4 -c copy -f flv \\"
echo "       \"rtmp://stream.port-80.com/live/{EVENT_UUID}?token=<rtmp-shared-token>\""
echo "  4. Generate tickets in admin → distribute to viewers"
echo "  5. Viewers visit https://${PLATFORM_FQDN} → enter ticket → watch"
echo ""
echo "--------------------------------------------"
echo "  DNS Setup (optional — custom domains)"
echo "--------------------------------------------"
echo "  PLATFORM_APP_FQDN=\"${PLATFORM_FQDN}\" \\"
echo "  HLS_SERVER_FQDN=\"${HLS_FQDN}\" \\"
echo "  ./dns-deploy.sh"
echo ""
echo "Azure Portal:"
echo "  https://portal.azure.com/#@/resource/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}/overview"
echo ""
echo "To remove StreamGate only:  ./destroy.sh"
echo "To remove DNS records:      ./dns-destroy.sh"
echo "============================================"
