#!/usr/bin/env bash
# ============================================================================
# Remove StreamGate DNS records (watch + hls CNAME records only)
# ============================================================================
# This does NOT delete the DNS zone — only removes StreamGate's CNAME records.
# The DNS zone and rtmp-go's 'stream' CNAME record are preserved.
#
# Usage:
#   ./dns-destroy.sh                              # prompts for confirmation
#   ./dns-destroy.sh --yes                        # skip confirmation
#   DNS_RESOURCE_GROUP=rg-dns ./dns-destroy.sh    # custom resource group
# ============================================================================
set -euo pipefail

DNS_RESOURCE_GROUP="${DNS_RESOURCE_GROUP:-rg-dns}"
DNS_ZONE_NAME="${DNS_ZONE_NAME:-port-80.com}"
PLATFORM_SUBDOMAIN="${PLATFORM_SUBDOMAIN:-watch}"
HLS_SUBDOMAIN="${HLS_SUBDOMAIN:-hls}"
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

# --- Check DNS zone exists ---
if ! az network dns zone show --name "$DNS_ZONE_NAME" --resource-group "$DNS_RESOURCE_GROUP" &>/dev/null 2>&1; then
  echo "DNS zone '$DNS_ZONE_NAME' not found in '$DNS_RESOURCE_GROUP'. Nothing to destroy."
  exit 0
fi

echo "============================================"
echo "  StreamGate DNS Record Removal"
echo "============================================"
echo ""
echo "DNS Zone: $DNS_ZONE_NAME (in $DNS_RESOURCE_GROUP)"
echo ""
echo "The following CNAME records will be DELETED:"
echo "  - ${PLATFORM_SUBDOMAIN}.${DNS_ZONE_NAME}"
echo "  - ${HLS_SUBDOMAIN}.${DNS_ZONE_NAME}"
echo ""
echo "The DNS zone and other records (e.g. stream.$DNS_ZONE_NAME) will NOT be affected."
echo ""

# --- Confirm ---
if [ "$SKIP_CONFIRM" = false ]; then
  read -rp "Type 'yes' to confirm: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

# --- Delete CNAME records ---
echo ""
echo ">>> Removing CNAME records..."

az network dns record-set cname delete \
  --name "$PLATFORM_SUBDOMAIN" \
  --zone-name "$DNS_ZONE_NAME" \
  --resource-group "$DNS_RESOURCE_GROUP" \
  --yes 2>/dev/null && echo "    Deleted: ${PLATFORM_SUBDOMAIN}.${DNS_ZONE_NAME}" || echo "    ${PLATFORM_SUBDOMAIN}.${DNS_ZONE_NAME} not found (skipped)"

az network dns record-set cname delete \
  --name "$HLS_SUBDOMAIN" \
  --zone-name "$DNS_ZONE_NAME" \
  --resource-group "$DNS_RESOURCE_GROUP" \
  --yes 2>/dev/null && echo "    Deleted: ${HLS_SUBDOMAIN}.${DNS_ZONE_NAME}" || echo "    ${HLS_SUBDOMAIN}.${DNS_ZONE_NAME} not found (skipped)"

echo ""
echo "============================================"
echo "  DNS Records Removed"
echo "============================================"
echo ""
echo "  ${PLATFORM_SUBDOMAIN}.${DNS_ZONE_NAME} and ${HLS_SUBDOMAIN}.${DNS_ZONE_NAME}"
echo "  will stop resolving after TTL expires."
echo ""
echo "  DNS zone '$DNS_ZONE_NAME' is preserved."
echo "============================================"
