#!/usr/bin/env bash
# ============================================================================
# Deploy DNS records for StreamGate custom domains
# ============================================================================
# Adds CNAME records to the existing port-80.com DNS zone (created by rtmp-go).
#
#   watch.port-80.com → StreamGate Platform App
#   hls.port-80.com   → StreamGate HLS Server
#
# Usage:
#   # After main deploy — create CNAME records:
#   PLATFORM_APP_FQDN="sg-platform-xxx.azurecontainerapps.io" \
#   HLS_SERVER_FQDN="sg-hls-xxx.azurecontainerapps.io" \
#   ./dns-deploy.sh
#
# Environment variables:
#   PLATFORM_APP_FQDN    — Platform App FQDN (from deploy.sh output)
#   HLS_SERVER_FQDN      — HLS Server FQDN (from deploy.sh output)
#   DNS_RESOURCE_GROUP   — Resource group for DNS zone (default: rg-dns)
#   DNS_ZONE_NAME        — Domain name (default: port-80.com)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Configuration ---
DNS_RESOURCE_GROUP="${DNS_RESOURCE_GROUP:-rg-dns}"
DNS_ZONE_NAME="${DNS_ZONE_NAME:-port-80.com}"
PLATFORM_APP_FQDN="${PLATFORM_APP_FQDN:-}"
HLS_SERVER_FQDN="${HLS_SERVER_FQDN:-}"

echo "============================================"
echo "  StreamGate DNS Deployment"
echo "============================================"
echo "Resource Group:  $DNS_RESOURCE_GROUP"
echo "DNS Zone:        $DNS_ZONE_NAME"
if [ -n "$PLATFORM_APP_FQDN" ]; then
  echo "Platform CNAME:  watch.$DNS_ZONE_NAME → $PLATFORM_APP_FQDN"
else
  echo "Platform CNAME:  (skipped — set PLATFORM_APP_FQDN)"
fi
if [ -n "$HLS_SERVER_FQDN" ]; then
  echo "HLS CNAME:       hls.$DNS_ZONE_NAME → $HLS_SERVER_FQDN"
else
  echo "HLS CNAME:       (skipped — set HLS_SERVER_FQDN)"
fi
echo "============================================"

# --- Verify Azure CLI login ---
if ! az account show &>/dev/null; then
  echo "ERROR: Not logged in to Azure CLI. Run 'az login' first."
  exit 1
fi

# --- Check DNS resource group exists ---
if ! az group show --name "$DNS_RESOURCE_GROUP" &>/dev/null 2>&1; then
  echo "ERROR: DNS resource group '$DNS_RESOURCE_GROUP' does not exist."
  echo "       Deploy the DNS zone first: cd ../rtmp-go/azure && ./dns-deploy.sh"
  exit 1
fi

# --- Deploy DNS Bicep template ---
echo ""
echo ">>> Deploying DNS records..."

DEPLOY_OUTPUT=$(az deployment group create \
  --resource-group "$DNS_RESOURCE_GROUP" \
  --name "streamgate-dns" \
  --template-file "$SCRIPT_DIR/infra/dns.bicep" \
  --parameters "$SCRIPT_DIR/infra/dns.parameters.json" \
  --parameters \
    platformAppFqdn="$PLATFORM_APP_FQDN" \
    hlsServerFqdn="$HLS_SERVER_FQDN" \
  --query 'properties.outputs' \
  --output json)

PLATFORM_DOMAIN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformDomain']['value'])")
HLS_DOMAIN=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsDomain']['value'])")
PLATFORM_TARGET=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['platformCnameTarget']['value'])")
HLS_TARGET=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['hlsCnameTarget']['value'])")

echo ""
echo "============================================"
echo "  StreamGate DNS Records Deployed!"
echo "============================================"
echo ""

if [ -n "$PLATFORM_APP_FQDN" ]; then
  echo "Platform:"
  echo "  $PLATFORM_DOMAIN → $PLATFORM_TARGET"
  echo "  https://$PLATFORM_DOMAIN"
  echo ""
fi

if [ -n "$HLS_SERVER_FQDN" ]; then
  echo "HLS Server:"
  echo "  $HLS_DOMAIN → $HLS_TARGET"
  echo "  https://$HLS_DOMAIN"
  echo ""
fi

echo "Verify with:"
if [ -n "$PLATFORM_APP_FQDN" ]; then
  echo "  nslookup $PLATFORM_DOMAIN"
fi
if [ -n "$HLS_SERVER_FQDN" ]; then
  echo "  nslookup $HLS_DOMAIN"
fi

echo ""
echo "NOTE: Custom domains will be auto-detected on next deployment."
echo "  Just run: ./deploy.sh"
echo ""
echo "  Or override explicitly:"
echo "  HLS_SERVER_BASE_URL=\"https://$HLS_DOMAIN\" \\"
echo "  CORS_ALLOWED_ORIGIN=\"https://$PLATFORM_DOMAIN\" \\"
echo "  PLATFORM_APP_URL=\"https://$PLATFORM_DOMAIN\" \\"
echo "  ./deploy.sh"
echo ""
echo "To remove these DNS records: ./dns-destroy.sh"
echo "============================================"
