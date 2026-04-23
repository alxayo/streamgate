// ============================================================================
// Azure Container Apps Infrastructure for StreamGate
// ============================================================================
// Deploys INTO an existing rtmp-go environment (same resource group):
//   - Azure Files share: streamgate-data (SQLite database)
//   - Azure Files share: segment-cache (HLS segment cache)
//   - Container Apps Environment storage mounts (3)
//   - Container App: streamgate-platform (Next.js viewer portal + admin)
//   - Container App: streamgate-hls (Express HLS media server)
//
// Prerequisites:
//   rtmp-go must be deployed first (provides ACR, Storage, Identity, ACA Env)
//
// Usage:
//   az deployment group create -g rg-rtmpgo -f main.bicep -p main.parameters.json
// ============================================================================

targetScope = 'resourceGroup'

// ---------- Parameters ----------

@description('Base name used for generating unique resource names')
param environmentName string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Name of the existing Container Apps Environment (from rtmp-go deployment)')
param containerEnvName string

@description('Login server of the existing Azure Container Registry')
param registryLoginServer string

@description('Resource ID of the existing user-assigned managed identity')
param identityId string

@description('Client ID of the existing user-assigned managed identity')
param identityClientId string

@description('Name of the existing storage account (from rtmp-go deployment)')
param storageAccountName string

@description('Container image for streamgate-platform (set after ACR build)')
param platformImage string = ''

@description('Container image for streamgate-hls (set after ACR build)')
param hlsServerImage string = ''

@description('HMAC-SHA256 secret for JWT playback tokens (must match between platform and HLS server)')
@secure()
param playbackSigningSecret string

@description('Shared API key for internal endpoints (revocation sync)')
@secure()
param internalApiKey string

@description('Bcrypt hash of the admin password')
@secure()
param adminPasswordHash string

@description('Name of the existing HLS output file share (from rtmp-go deployment)')
param hlsOutputShareName string = 'hls-output'

@description('Public URL of the HLS server (set after DNS setup, defaults to ACA FQDN)')
param hlsServerBaseUrl string = ''

@description('CORS allowed origin for HLS server (the platform app domain)')
param corsAllowedOrigin string = ''

@description('IP address allowed to access the admin console (empty = no restriction)')
param adminAllowedIp string = ''

@description('Platform app URL for HLS server revocation polling (set on second deploy pass)')
param platformAppUrl string = ''

// ---------- Variables ----------

var resourceToken = uniqueString(subscription().id, resourceGroup().id, location, environmentName)
var platformAppName = 'sg-platform-${resourceToken}'
var hlsAppName = 'sg-hls-${resourceToken}'

// ---------- Existing Resources (from rtmp-go deployment) ----------

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerEnvName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' existing = {
  name: 'default'
  parent: storageAccount
}

// ---------- Azure Files Shares (StreamGate-specific) ----------

// Reference the existing hls-output storage mount (created by rtmp-go deployment, ReadWrite)
resource hlsOutputStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' existing = {
  name: 'hls-output'
  parent: containerEnv
}

resource streamgateDataShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  name: 'streamgate-data'
  parent: fileService
  properties: {
    shareQuota: 1 // 1 GiB — SQLite database
  }
}

resource segmentCacheShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  name: 'segment-cache'
  parent: fileService
  properties: {
    shareQuota: 10 // 10 GiB — HLS segment cache
  }
}

// ---------- Container Apps Environment Storage Mounts ----------

resource streamgateDataStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  name: 'streamgate-data'
  parent: containerEnv
  properties: {
    azureFile: {
      accountName: storageAccount.name
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: streamgateDataShare.name
      accessMode: 'ReadWrite'
    }
  }
}

resource segmentCacheStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  name: 'segment-cache'
  parent: containerEnv
  properties: {
    azureFile: {
      accountName: storageAccount.name
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: segmentCacheShare.name
      accessMode: 'ReadWrite'
    }
  }
}

// ---------- Container App: streamgate-hls ----------
// HLS media server — must be defined BEFORE platform so we can reference its FQDN.
// Validates JWT on every .m3u8 / .ts request. Serves from Azure Files (local)
// with Blob Storage fallback (upstream proxy). Polls platform for revocations.

resource hlsApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: hlsAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registryLoginServer
          identity: identityId
        }
      ]
      ingress: {
        external: true
        targetPort: 4000
        transport: 'http'
      }
      secrets: [
        {
          name: 'playback-signing-secret'
          value: playbackSigningSecret
        }
        {
          name: 'internal-api-key'
          value: internalApiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'streamgate-hls'
          image: !empty(hlsServerImage) ? hlsServerImage : 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'PORT'
              value: '4000'
            }
            {
              name: 'PLAYBACK_SIGNING_SECRET'
              secretRef: 'playback-signing-secret'
            }
            {
              name: 'INTERNAL_API_KEY'
              secretRef: 'internal-api-key'
            }
            {
              name: 'STREAM_ROOT'
              value: '/hls-output'
            }
            {
              name: 'UPSTREAM_ORIGIN'
              value: 'https://${storageAccountName}.blob.core.windows.net/hls-content/hls'
            }
            {
              name: 'STREAM_KEY_PREFIX'
              value: 'live_'
            }
            {
              name: 'SEGMENT_CACHE_ROOT'
              value: '/segment-cache'
            }
            {
              name: 'SEGMENT_CACHE_MAX_SIZE_GB'
              value: '8'
            }
            {
              name: 'SEGMENT_CACHE_MAX_AGE_HOURS'
              value: '72'
            }
            {
              name: 'REVOCATION_POLL_INTERVAL_MS'
              value: '30000'
            }
            {
              // PLATFORM_APP_URL is resolved on the second deploy pass via platformAppUrl parameter.
              // On first pass it's a placeholder since platformApp hasn't been created yet.
              name: 'PLATFORM_APP_URL'
              value: !empty(platformAppUrl) ? platformAppUrl : 'https://PLACEHOLDER'
            }
            {
              name: 'CORS_ALLOWED_ORIGIN'
              value: !empty(corsAllowedOrigin) ? corsAllowedOrigin : 'https://PLACEHOLDER'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'hls-output'
              mountPath: '/hls-output'
            }
            {
              volumeName: 'segment-cache'
              mountPath: '/segment-cache'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'hls-output'
          storageName: hlsOutputStorage.name
          storageType: 'AzureFile'
        }
        {
          name: 'segment-cache'
          storageName: segmentCacheStorage.name
          storageType: 'AzureFile'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ---------- Container App: streamgate-platform ----------
// Next.js application — viewer portal, admin console, API routes.
// Issues JWTs, manages sessions, serves revocation data to HLS server.

resource platformApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: platformAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registryLoginServer
          identity: identityId
        }
      ]
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
      }
      secrets: [
        {
          name: 'playback-signing-secret'
          value: playbackSigningSecret
        }
        {
          name: 'internal-api-key'
          value: internalApiKey
        }
        {
          name: 'admin-password-hash'
          value: adminPasswordHash
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'streamgate-platform'
          image: !empty(platformImage) ? platformImage : 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'DATABASE_URL'
              value: 'file:/data/streamgate.db'
            }
            {
              name: 'PLAYBACK_SIGNING_SECRET'
              secretRef: 'playback-signing-secret'
            }
            {
              name: 'INTERNAL_API_KEY'
              secretRef: 'internal-api-key'
            }
            {
              name: 'ADMIN_PASSWORD_HASH'
              secretRef: 'admin-password-hash'
            }
            {
              name: 'HLS_SERVER_BASE_URL'
              value: !empty(hlsServerBaseUrl) ? hlsServerBaseUrl : 'https://${hlsApp.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'NEXT_PUBLIC_APP_NAME'
              value: 'StreamGate'
            }
            {
              name: 'SESSION_TIMEOUT_SECONDS'
              value: '60'
            }
            {
              name: 'ADMIN_ALLOWED_IP'
              value: adminAllowedIp
            }
          ]
          volumeMounts: [
            {
              volumeName: 'streamgate-data'
              mountPath: '/data'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'streamgate-data'
          storageName: streamgateDataStorage.name
          storageType: 'AzureFile'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ---------- Update HLS Server with Platform URL ----------
// The HLS server needs the platform app FQDN for revocation polling.
// Since we now have the platform FQDN, we redeploy the HLS app with correct values.
// This is handled by the deploy script's second Bicep pass — the first pass uses
// placeholders, and the second pass provides the correct URLs via parameters.

// ---------- Outputs ----------

output platformAppName string = platformApp.name
output hlsServerAppName string = hlsApp.name
output platformAppFqdn string = platformApp.properties.configuration.ingress.fqdn
output hlsServerFqdn string = hlsApp.properties.configuration.ingress.fqdn
output storageAccountName string = storageAccount.name
output containerEnvName string = containerEnv.name
