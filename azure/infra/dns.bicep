// ============================================================================
// Azure DNS Records for StreamGate custom domains
// ============================================================================
// Adds CNAME records to an EXISTING DNS zone (created by rtmp-go/azure/dns-deploy.sh).
//
//   watch.port-80.com → StreamGate Platform App FQDN
//   hls.port-80.com   → StreamGate HLS Server FQDN
//
// Usage:
//   az deployment group create -g rg-dns -f dns.bicep -p dns.parameters.json \
//     -p platformAppFqdn="sg-platform-xxx.azurecontainerapps.io" \
//     -p hlsServerFqdn="sg-hls-xxx.azurecontainerapps.io"
// ============================================================================

targetScope = 'resourceGroup'

// ---------- Parameters ----------

@description('DNS zone name (must already exist in this resource group)')
param zoneName string

@description('Subdomain for the platform app (viewer portal + admin)')
param platformSubdomain string = 'watch'

@description('Subdomain for the HLS media server')
param hlsSubdomain string = 'hls'

@description('FQDN of the StreamGate Platform App. Leave empty to skip CNAME creation.')
param platformAppFqdn string = ''

@description('FQDN of the StreamGate HLS Server. Leave empty to skip CNAME creation.')
param hlsServerFqdn string = ''

@description('TTL in seconds for CNAME records')
param ttl int = 300

// ---------- Existing DNS Zone ----------

resource dnsZone 'Microsoft.Network/dnsZones@2023-07-01-preview' existing = {
  name: zoneName
}

// ---------- CNAME Records (conditional) ----------

resource platformCname 'Microsoft.Network/dnsZones/CNAME@2023-07-01-preview' = if (!empty(platformAppFqdn)) {
  name: platformSubdomain
  parent: dnsZone
  properties: {
    TTL: ttl
    CNAMERecord: {
      cname: platformAppFqdn
    }
  }
}

resource hlsCname 'Microsoft.Network/dnsZones/CNAME@2023-07-01-preview' = if (!empty(hlsServerFqdn)) {
  name: hlsSubdomain
  parent: dnsZone
  properties: {
    TTL: ttl
    CNAMERecord: {
      cname: hlsServerFqdn
    }
  }
}

// ---------- Outputs ----------

output platformDomain string = !empty(platformAppFqdn) ? '${platformSubdomain}.${zoneName}' : '(not configured)'
output hlsDomain string = !empty(hlsServerFqdn) ? '${hlsSubdomain}.${zoneName}' : '(not configured)'
output platformCnameTarget string = !empty(platformAppFqdn) ? platformAppFqdn : '(not configured)'
output hlsCnameTarget string = !empty(hlsServerFqdn) ? hlsServerFqdn : '(not configured)'
