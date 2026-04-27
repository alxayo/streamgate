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
#   ADMIN_SESSION_SECRET      — secret for session + TOTP encryption (auto-generated if empty)
#   HLS_SERVER_BASE_URL       — override HLS server public URL (auto-detected from DNS)
#   CORS_ALLOWED_ORIGIN       — override CORS origin (auto-detected from DNS)
#   PLATFORM_APP_URL          — override platform app URL for HLS→Platform comms (auto-detected from DNS)
#   DNS_RESOURCE_GROUP        — resource group for DNS zone (default: rg-dns)
#   DNS_ZONE_NAME             — domain name (default: port-80.com)
#   ADMIN_ALLOWED_IP          — IP allowed to access /admin (auto-detected if empty)
#
# Prerequisites:
#   - Azure CLI logged in (az login)
#   - rtmp-go deployed to the resource group (provides ACR, Storage, ACA Env)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STREAMGATE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Verify container app is running after deployment ---
verify_deployment() {
  local app_name="$1"
  local max_retries=12  # 2 minutes with 10s intervals
  local retry=0

  echo "  Verifying $app_name..."

  while [ $retry -lt $max_retries ]; do
    local status
    status=$(az containerapp revision list \
      --name "$app_name" \
      -g "$RESOURCE_GROUP" \
      --query "[?properties.active].properties.runningState" \
      -o tsv 2>/dev/null | head -1)

    if echo "$status" | grep -qi "Running"; then
      echo "    ✓ $app_name is running"
      return 0
    fi

    retry=$((retry + 1))
    echo "    Waiting for $app_name to be ready... ($retry/$max_retries)"
    sleep 10
  done

  echo "    ✗ WARNING: $app_name may not be running after deployment"
  return 1
}

DEPLOY_WARNINGS=0

# --- Configuration ---
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-rtmpgo}"
LOCATION="${LOCATION:-eastus2}"
IMAGE_TAG="v$(date +%s)"

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

# Auto-generate ADMIN_SESSION_SECRET if not set
if [ -z "${ADMIN_SESSION_SECRET:-}" ]; then
  ADMIN_SESSION_SECRET=$(openssl rand -base64 32)
  echo "    Generated ADMIN_SESSION_SECRET (save this!):"
  echo "    $ADMIN_SESSION_SECRET"
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
    adminSessionSecret="$ADMIN_SESSION_SECRET" \
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
  --image "streamgate-platform:${IMAGE_TAG}" \
  --file "$STREAMGATE_ROOT/platform/Dockerfile" \
  "$STREAMGATE_ROOT" \
  --no-logs --output none

echo "    Building streamgate-hls..."
az acr build \
  --registry "$ACR_NAME" \
  --image "streamgate-hls:${IMAGE_TAG}" \
  --file "$STREAMGATE_ROOT/hls-server/Dockerfile" \
  "$STREAMGATE_ROOT" \
  --no-logs --output none

echo "    Images built and pushed."

# --- Step 6: Redeploy Bicep with real images + resolved URLs ---
echo ""
echo ">>> Step 6/7: Deploying container apps with built images..."

# --- Auto-detect custom domains from DNS zone ---
# If custom domain env vars are not explicitly set, check if DNS CNAME records exist.
# This ensures redeployments after dns-deploy.sh automatically use the custom domains.
DNS_RG="${DNS_RESOURCE_GROUP:-rg-dns}"
DNS_ZONE="${DNS_ZONE_NAME:-port-80.com}"

if [ -z "${HLS_SERVER_BASE_URL:-}" ] || [ -z "${CORS_ALLOWED_ORIGIN:-}" ] || [ -z "${PLATFORM_APP_URL:-}" ]; then
  echo "    Checking for custom domain DNS records in $DNS_ZONE..."
  WATCH_CNAME=$(az network dns record-set cname show \
    --resource-group "$DNS_RG" --zone-name "$DNS_ZONE" --name "watch" \
    --query 'CNAMERecord.cname' -o tsv 2>/dev/null || echo "")
  HLS_CNAME=$(az network dns record-set cname show \
    --resource-group "$DNS_RG" --zone-name "$DNS_ZONE" --name "hls" \
    --query 'CNAMERecord.cname' -o tsv 2>/dev/null || echo "")

  if [ -n "$WATCH_CNAME" ]; then
    echo "    Found: watch.$DNS_ZONE → $WATCH_CNAME"
  fi
  if [ -n "$HLS_CNAME" ]; then
    echo "    Found: hls.$DNS_ZONE → $HLS_CNAME"
  fi
fi

# Resolve effective URLs: explicit override > custom domain > ACA FQDN
if [ -n "${HLS_SERVER_BASE_URL:-}" ]; then
  EFFECTIVE_HLS_BASE_URL="$HLS_SERVER_BASE_URL"
elif [ -n "${HLS_CNAME:-}" ]; then
  EFFECTIVE_HLS_BASE_URL="https://hls.$DNS_ZONE"
  echo "    Using custom domain for HLS: $EFFECTIVE_HLS_BASE_URL"
else
  EFFECTIVE_HLS_BASE_URL="https://${HLS_FQDN}"
fi

if [ -n "${CORS_ALLOWED_ORIGIN:-}" ]; then
  EFFECTIVE_CORS_ORIGIN="$CORS_ALLOWED_ORIGIN"
elif [ -n "${WATCH_CNAME:-}" ]; then
  EFFECTIVE_CORS_ORIGIN="https://watch.$DNS_ZONE"
  echo "    Using custom domain for CORS: $EFFECTIVE_CORS_ORIGIN"
else
  EFFECTIVE_CORS_ORIGIN="https://${PLATFORM_FQDN}"
fi

if [ -n "${PLATFORM_APP_URL:-}" ]; then
  EFFECTIVE_PLATFORM_APP_URL="$PLATFORM_APP_URL"
elif [ -n "${WATCH_CNAME:-}" ]; then
  EFFECTIVE_PLATFORM_APP_URL="https://watch.$DNS_ZONE"
  echo "    Using custom domain for Platform URL: $EFFECTIVE_PLATFORM_APP_URL"
else
  EFFECTIVE_PLATFORM_APP_URL="https://${PLATFORM_FQDN}"
fi

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

# Generate an admin SAS token with write/delete permissions (for purge + finalize operations)
echo "    Generating admin SAS token for hls-content blob write/delete..."
UPSTREAM_ADMIN_SAS_TOKEN=$(az storage container generate-sas \
  --account-name "$STORAGE_ACCOUNT" \
  --name hls-content \
  --permissions rwdl \
  --expiry "$(date -u -v+1y '+%Y-%m-%dT%H:%MZ' 2>/dev/null || date -u -d '+1 year' '+%Y-%m-%dT%H:%MZ')" \
  --https-only \
  -o tsv)
echo "    Admin SAS token generated (expires in 1 year)."

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
    adminSessionSecret="$ADMIN_SESSION_SECRET" \
    platformImage="${REGISTRY_LOGIN_SERVER}/streamgate-platform:${IMAGE_TAG}" \
    hlsServerImage="${REGISTRY_LOGIN_SERVER}/streamgate-hls:${IMAGE_TAG}" \
    hlsServerBaseUrl="$EFFECTIVE_HLS_BASE_URL" \
    corsAllowedOrigin="$EFFECTIVE_CORS_ORIGIN" \
    platformAppUrl="$EFFECTIVE_PLATFORM_APP_URL" \
    upstreamSasToken="$UPSTREAM_SAS_TOKEN" \
    upstreamAdminSasToken="$UPSTREAM_ADMIN_SAS_TOKEN" \
    adminAllowedIp="${ADMIN_ALLOWED_IP:-}" \
  --query 'properties.outputs' \
  --output json)

PLATFORM_APP_NAME=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformAppName']['value'])")
HLS_APP_NAME=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsServerAppName']['value'])")
PLATFORM_FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformAppFqdn']['value'])")
HLS_FQDN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsServerFqdn']['value'])")

# --- Bind custom domains (after Bicep, via CLI) ---
if [ -n "${WATCH_CNAME:-}" ]; then
  echo "    Binding custom domain watch.$DNS_ZONE to $PLATFORM_APP_NAME..."
  # Check if already bound
  EXISTING_WATCH=$(az containerapp hostname list -g "$RESOURCE_GROUP" -n "$PLATFORM_APP_NAME" \
    --query "[?name=='watch.$DNS_ZONE'].name" -o tsv 2>/dev/null || echo "")
  if [ -z "$EXISTING_WATCH" ]; then
    az containerapp hostname add -g "$RESOURCE_GROUP" -n "$PLATFORM_APP_NAME" \
      --hostname "watch.$DNS_ZONE" --output none 2>/dev/null
    az containerapp hostname bind -g "$RESOURCE_GROUP" -n "$PLATFORM_APP_NAME" \
      --hostname "watch.$DNS_ZONE" --environment "$CONTAINER_ENV_NAME" \
      --validation-method CNAME --output none 2>/dev/null
    echo "    ✓ watch.$DNS_ZONE bound with managed certificate"
  else
    echo "    watch.$DNS_ZONE already bound"
  fi
fi

if [ -n "${HLS_CNAME:-}" ]; then
  echo "    Binding custom domain hls.$DNS_ZONE to $HLS_APP_NAME..."
  EXISTING_HLS=$(az containerapp hostname list -g "$RESOURCE_GROUP" -n "$HLS_APP_NAME" \
    --query "[?name=='hls.$DNS_ZONE'].name" -o tsv 2>/dev/null || echo "")
  if [ -z "$EXISTING_HLS" ]; then
    az containerapp hostname add -g "$RESOURCE_GROUP" -n "$HLS_APP_NAME" \
      --hostname "hls.$DNS_ZONE" --output none 2>/dev/null
    az containerapp hostname bind -g "$RESOURCE_GROUP" -n "$HLS_APP_NAME" \
      --hostname "hls.$DNS_ZONE" --environment "$CONTAINER_ENV_NAME" \
      --validation-method CNAME --output none 2>/dev/null
    echo "    ✓ hls.$DNS_ZONE bound with managed certificate"
  else
    echo "    hls.$DNS_ZONE already bound"
  fi
fi

# --- Step 7: Verify ---
echo ""
echo ">>> Step 7/7: Verifying deployment..."

verify_deployment "$PLATFORM_APP_NAME" || DEPLOY_WARNINGS=$((DEPLOY_WARNINGS + 1))
verify_deployment "$HLS_APP_NAME" || DEPLOY_WARNINGS=$((DEPLOY_WARNINGS + 1))

SUBSCRIPTION=$(az account show --query 'id' --output tsv)

# --- Deployment Summary ---
echo ""
echo "=== Deployment Summary ==="
echo "Image tag: $IMAGE_TAG"
echo "Resources deployed:"
for app in "$PLATFORM_APP_NAME" "$HLS_APP_NAME"; do
  az containerapp show --name "$app" -g "$RESOURCE_GROUP" \
    --query "{Name:name, Revision:properties.latestRevisionName, FQDN:properties.configuration.ingress.fqdn}" \
    -o table 2>/dev/null
done
if [ "$DEPLOY_WARNINGS" -gt 0 ]; then
  echo ""
  echo "⚠ $DEPLOY_WARNINGS app(s) may not be running — check Azure Portal for details."
fi

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
if [ "$EFFECTIVE_CORS_ORIGIN" != "https://${PLATFORM_FQDN}" ]; then
  echo "  (Custom domain: ${EFFECTIVE_CORS_ORIGIN}/admin)"
fi
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
if [ -n "${WATCH_CNAME:-}" ]; then
  echo "  5. Viewers visit https://watch.$DNS_ZONE → enter ticket → watch"
else
  echo "  5. Viewers visit https://${PLATFORM_FQDN} → enter ticket → watch"
fi
echo ""
echo "--------------------------------------------"
echo "  Custom Domains"
echo "--------------------------------------------"
if [ -n "${WATCH_CNAME:-}" ] || [ -n "${HLS_CNAME:-}" ]; then
  echo "  Custom domains active (auto-detected from DNS):"
  [ -n "${WATCH_CNAME:-}" ] && echo "    Platform: https://watch.$DNS_ZONE"
  [ -n "${HLS_CNAME:-}" ] && echo "    HLS:      https://hls.$DNS_ZONE"
  echo "  HLS Base URL:    $EFFECTIVE_HLS_BASE_URL"
  echo "  CORS Origin:     $EFFECTIVE_CORS_ORIGIN"
  echo "  Platform App URL: $EFFECTIVE_PLATFORM_APP_URL"
else
  echo "  No custom domains detected. To set up:"
  echo "  PLATFORM_APP_FQDN=\"${PLATFORM_FQDN}\" \\"
  echo "  HLS_SERVER_FQDN=\"${HLS_FQDN}\" \\"
  echo "  ./dns-deploy.sh"
  echo "  Then redeploy: ./deploy.sh (domains will be auto-detected)"
fi
echo ""
echo "Azure Portal:"
echo "  https://portal.azure.com/#@/resource/subscriptions/${SUBSCRIPTION}/resourceGroups/${RESOURCE_GROUP}/overview"
echo ""
echo "To remove StreamGate only:  ./destroy.sh"
echo "To remove DNS records:      ./dns-destroy.sh"
echo "============================================"
