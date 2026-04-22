#!/usr/bin/env bash
# ============================================================================
# Destroy StreamGate resources — selectively removes ONLY StreamGate components
# ============================================================================
# This script does NOT delete the resource group (shared with rtmp-go).
# It removes only StreamGate container apps, storage mounts, and file shares.
#
# Usage:
#   ./destroy.sh                                # prompts for confirmation
#   ./destroy.sh --yes                          # skip confirmation
#   RESOURCE_GROUP=rg-custom ./destroy.sh       # custom resource group
# ============================================================================
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-rtmpgo}"
SKIP_CONFIRM=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y) SKIP_CONFIRM=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# --- Verify Azure CLI login ---
if ! az account show &>/dev/null; then
  echo "ERROR: Not logged in to Azure CLI. Run 'az login' first."
  exit 1
fi

# --- Discover StreamGate resources ---
echo "============================================"
echo "  StreamGate Selective Teardown"
echo "============================================"
echo ""
echo "Resource Group: $RESOURCE_GROUP (shared — will NOT be deleted)"
echo ""

# Find the StreamGate deployment
SG_OUTPUTS=$(az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name "streamgate" \
  --query 'properties.outputs' \
  --output json 2>/dev/null || echo "")

if [ -z "$SG_OUTPUTS" ] || [ "$SG_OUTPUTS" = "" ]; then
  echo "No StreamGate deployment found in '$RESOURCE_GROUP'. Nothing to destroy."
  exit 0
fi

PLATFORM_APP=$(echo "$SG_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformAppName']['value'])")
HLS_APP=$(echo "$SG_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsServerAppName']['value'])")
CONTAINER_ENV=$(echo "$SG_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['containerEnvName']['value'])")
STORAGE_ACCOUNT=$(echo "$SG_OUTPUTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['storageAccountName']['value'])")

# Find ACR from rtmp-go deployment
ACR_NAME=$(az deployment group list \
  --resource-group "$RESOURCE_GROUP" \
  --query "[?properties.outputs.rtmpAppName != null] | [0].properties.outputs.registryName.value" \
  --output tsv 2>/dev/null || echo "")

echo "The following StreamGate resources will be DELETED:"
echo ""
echo "  Container Apps:"
echo "    - $PLATFORM_APP"
echo "    - $HLS_APP"
echo ""
echo "  Storage Mounts (on Container Apps Environment):"
echo "    - streamgate-data"
echo "    - segment-cache"
echo "    - hls-output-ro"
echo ""
echo "  Azure Files Shares (on storage account $STORAGE_ACCOUNT):"
echo "    - streamgate-data"
echo "    - segment-cache"
echo ""
if [ -n "$ACR_NAME" ]; then
  echo "  ACR Images (on registry $ACR_NAME):"
  echo "    - streamgate-platform:latest"
  echo "    - streamgate-hls:latest"
  echo ""
fi
echo "  rtmp-go resources will NOT be affected."
echo ""

# --- Confirm ---
if [ "$SKIP_CONFIRM" = false ]; then
  read -rp "Type 'streamgate' to confirm deletion: " CONFIRM
  if [ "$CONFIRM" != "streamgate" ]; then
    echo "Aborted. Input did not match 'streamgate'."
    exit 1
  fi
fi

# --- Delete Container Apps ---
echo ""
echo ">>> Deleting container apps..."

az containerapp delete \
  --name "$PLATFORM_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --yes 2>/dev/null && echo "    Deleted $PLATFORM_APP" || echo "    $PLATFORM_APP not found (skipped)"

az containerapp delete \
  --name "$HLS_APP" \
  --resource-group "$RESOURCE_GROUP" \
  --yes 2>/dev/null && echo "    Deleted $HLS_APP" || echo "    $HLS_APP not found (skipped)"

# --- Delete storage mounts ---
echo ""
echo ">>> Removing storage mounts from Container Apps Environment..."

for MOUNT_NAME in streamgate-data segment-cache hls-output-ro; do
  az containerapp env storage remove \
    --name "$CONTAINER_ENV" \
    --resource-group "$RESOURCE_GROUP" \
    --storage-name "$MOUNT_NAME" \
    --yes 2>/dev/null && echo "    Removed mount: $MOUNT_NAME" || echo "    Mount $MOUNT_NAME not found (skipped)"
done

# --- Delete Azure Files shares ---
echo ""
echo ">>> Deleting Azure Files shares..."

STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query '[0].value' --output tsv 2>/dev/null || echo "")

if [ -n "$STORAGE_KEY" ]; then
  for SHARE_NAME in streamgate-data segment-cache; do
    az storage share delete \
      --name "$SHARE_NAME" \
      --account-name "$STORAGE_ACCOUNT" \
      --account-key "$STORAGE_KEY" \
      2>/dev/null && echo "    Deleted share: $SHARE_NAME" || echo "    Share $SHARE_NAME not found (skipped)"
  done
else
  echo "    WARNING: Could not get storage key. File shares may need manual deletion."
fi

# --- Delete ACR images ---
if [ -n "$ACR_NAME" ]; then
  echo ""
  echo ">>> Removing ACR images..."
  for IMAGE in streamgate-platform streamgate-hls; do
    az acr repository delete \
      --name "$ACR_NAME" \
      --image "${IMAGE}:latest" \
      --yes 2>/dev/null && echo "    Deleted image: ${IMAGE}:latest" || echo "    Image ${IMAGE}:latest not found (skipped)"
  done
fi

echo ""
echo "============================================"
echo "  StreamGate Teardown Complete"
echo "============================================"
echo ""
echo "  StreamGate resources have been removed."
echo "  rtmp-go resources are unaffected."
echo ""
echo "  To also remove DNS records: ./dns-destroy.sh"
echo "============================================"
