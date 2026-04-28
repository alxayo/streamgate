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

@description('Secret for admin session encryption and TOTP secret encryption (min 32 chars)')
@secure()
param adminSessionSecret string

@description('Name of the existing HLS output file share (from rtmp-go deployment)')
param hlsOutputShareName string = 'hls-output'

@description('Public URL of the HLS server (set after DNS setup, defaults to ACA FQDN)')
param hlsServerBaseUrl string = ''

@description('CORS allowed origin for HLS server (the platform app domain)')
param corsAllowedOrigin string = ''

@description('IP address allowed to access the admin console (empty = no restriction)')
param adminAllowedIp string = ''

@description('RTMP auth token for validating publish requests from the RTMP server callback')
@secure()
param rtmpAuthToken string = ''

@description('Platform app URL for HLS server revocation polling (set on second deploy pass)')
param platformAppUrl string = ''

@description('SAS token for read-only access to hls-content blob container (set on second deploy pass)')
@secure()
param upstreamSasToken string = ''

@description('SAS token for write/delete access to hls-content blob container (admin operations: purge, finalize)')
@secure()
param upstreamAdminSasToken string = ''

// --- VOD Transcoding Parameters ---
// These configure the Container Apps Jobs used for multi-codec VOD transcoding.
// Each codec (H.264, AV1, VP8, VP9) gets its own pre-created Job definition.
// The Platform App starts job executions on demand via the SDK.

@description('ACR image for H.264 file transcoder (e.g., myacr.azurecr.io/streamgate-transcode-h264:v1)')
param transcoderImageH264 string = ''

@description('ACR image for AV1 file transcoder')
param transcoderImageAv1 string = ''

@description('ACR image for VP8 file transcoder')
param transcoderImageVp8 string = ''

@description('ACR image for VP9 file transcoder')
param transcoderImageVp9 string = ''

@description('CPU cores per transcoder container (default: 4)')
param transcoderCpuCores string = '4'

@description('Memory in GB per transcoder container (default: 8)')
param transcoderMemoryGb string = '8'

@description('Maximum time in seconds for a transcoding job to complete (default: 7200 = 2 hours)')
param transcoderReplicaTimeout int = 7200

@description('Azure Storage connection string for transcoder blob access')
@secure()
param azureStorageConnectionString string = ''

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

// ---------- Blob Containers ----------

// Reference the blob service on the existing storage account
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  name: 'default'
  parent: storageAccount
}

// Blob container for VOD source uploads. The platform uploads creator video
// files here after saving to disk, and transcoder containers download from
// here. Blob name convention: {eventId}/{filename}
resource vodUploadsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: 'vod-uploads'
  parent: blobService
  properties: {
    publicAccess: 'None'
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
// Validates JWT on every .m3u8 / .ts request. Serves directly from Blob Storage
// (upstream proxy mode) — no Azure Files SMB mount needed. Polls platform for revocations.

resource hlsApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: hlsAppName
  location: location
  tags: {
    role: 'hls-server'
    component: 'streamgate'
  }
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
        ...(!empty(upstreamSasToken) ? [
          {
            name: 'upstream-sas-token'
            value: upstreamSasToken
          }
        ] : [])
        ...(!empty(upstreamAdminSasToken) ? [
          {
            name: 'upstream-admin-sas-token'
            value: upstreamAdminSasToken
          }
        ] : [])
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
              name: 'UPSTREAM_ORIGIN'
              value: 'https://${storageAccountName}.blob.core.windows.net/hls-content'
            }
            ...(!empty(upstreamSasToken) ? [
              {
                name: 'UPSTREAM_SAS_TOKEN'
                secretRef: 'upstream-sas-token'
              }
            ] : [])
            ...(!empty(upstreamAdminSasToken) ? [
              {
                name: 'UPSTREAM_ADMIN_SAS_TOKEN'
                secretRef: 'upstream-admin-sas-token'
              }
            ] : [])
            {
              name: 'STREAM_KEY_PREFIX'
              value: '' // Empty for HTTP ingest mode (blobs at {eventId}/..., not live_{eventId}/...)
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
              volumeName: 'segment-cache'
              mountPath: '/segment-cache'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'segment-cache'
          storageName: segmentCacheStorage.name
          storageType: 'AzureFile'
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
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
  tags: {
    role: 'platform'
    component: 'streamgate'
  }
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
        {
          name: 'admin-session-secret'
          value: adminSessionSecret
        }
        ...(!empty(rtmpAuthToken) ? [
          {
            name: 'rtmp-auth-token'
            value: rtmpAuthToken
          }
        ] : [])
        ...(!empty(azureStorageConnectionString) ? [
          {
            name: 'azure-storage-connection-string'
            value: azureStorageConnectionString
          }
        ] : [])
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
              name: 'ADMIN_SESSION_SECRET'
              secretRef: 'admin-session-secret'
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
            // Azure Storage connection string — needed by the platform to upload
            // VOD source files to blob storage after the creator's upload completes.
            // Only set when azureStorageConnectionString param is provided.
            ...(!empty(azureStorageConnectionString) ? [
              {
                name: 'AZURE_STORAGE_CONNECTION_STRING'
                secretRef: 'azure-storage-connection-string'
              }
            ] : [])
            ...(!empty(rtmpAuthToken) ? [
              {
                name: 'RTMP_AUTH_TOKEN'
                secretRef: 'rtmp-auth-token'
              }
            ] : [])
            // --- VOD Transcoding env vars ---
            // The Platform App needs these to start Container Apps Job executions
            // via the @azure/arm-appcontainers SDK (jobs.beginStart).
            // The job definitions themselves are created as separate resources below.
            {
              name: 'AZURE_SUBSCRIPTION_ID'
              value: subscription().subscriptionId
            }
            {
              name: 'AZURE_RESOURCE_GROUP'
              value: resourceGroup().name
            }
            // Managed identity client ID — needed by DefaultAzureCredential to
            // authenticate with user-assigned identity (for starting ACA Jobs).
            {
              name: 'AZURE_MANAGED_IDENTITY_CLIENT_ID'
              value: identityClientId
            }
            // Transcoder image refs — the launcher uses these to override the
            // container image in each job execution's template.
            ...(!empty(transcoderImageH264) ? [
              {
                name: 'TRANSCODER_IMAGE_H264'
                value: transcoderImageH264
              }
            ] : [])
            ...(!empty(transcoderImageAv1) ? [
              {
                name: 'TRANSCODER_IMAGE_AV1'
                value: transcoderImageAv1
              }
            ] : [])
            ...(!empty(transcoderImageVp8) ? [
              {
                name: 'TRANSCODER_IMAGE_VP8'
                value: transcoderImageVp8
              }
            ] : [])
            ...(!empty(transcoderImageVp9) ? [
              {
                name: 'TRANSCODER_IMAGE_VP9'
                value: transcoderImageVp9
              }
            ] : [])
            {
              name: 'TRANSCODER_CPU_CORES'
              value: transcoderCpuCores
            }
            {
              name: 'TRANSCODER_MEMORY_GB'
              value: transcoderMemoryGb
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

// ---------- VOD Transcoding Jobs ----------
// One Container Apps Job per codec. All live in the same Container Apps Environment
// as the platform + HLS server, so they share networking, logging, and registry access.
// The Platform App starts executions on-demand via `jobs.beginStart()` from the SDK,
// passing per-execution env var overrides (JOB_ID, EVENT_ID, CODEC, etc.).
// Azure manages execution lifecycle — timeout, retry, and cleanup are automatic.

// Map of codec names to their container images.
// Only codecs with a configured image will get a job definition created.
var transcoderImages = {
  h264: transcoderImageH264
  av1: transcoderImageAv1
  vp8: transcoderImageVp8
  vp9: transcoderImageVp9
}

// Create a Container Apps Job for each codec that has an image configured.
// Job naming convention: sg-transcode-{codec} (e.g., sg-transcode-h264)
@batchSize(1)
resource transcoderJobs 'Microsoft.App/jobs@2024-03-01' = [for codec in filter(items(transcoderImages), item => !empty(item.value)): {
  name: 'sg-transcode-${codec.key}'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    // Jobs run inside the same Container Apps Environment as platform + HLS
    environmentId: containerEnv.id
    configuration: {
      // Manual trigger — the Platform App starts executions via SDK
      triggerType: 'Manual'
      // Maximum time before Azure kills a stuck execution (default: 2 hours)
      replicaTimeout: transcoderReplicaTimeout
      // Retry once on transient failures (container crash, OOM, etc.)
      replicaRetryLimit: 1
      // ACR pull credentials — same managed identity as platform + HLS apps
      registries: [
        {
          server: registryLoginServer
          identity: identityId
        }
      ]
      // Secrets stored at the job level — referenced by execution env vars via secretRef.
      // These do NOT change per-execution, so they're defined here rather than passed inline.
      secrets: [
        {
          name: 'azure-storage-connection-string'
          value: azureStorageConnectionString
        }
        {
          name: 'internal-api-key'
          value: internalApiKey
        }
      ]
    }
    // Default template — overridden per-execution by the Platform App's launcher.
    // The image and env vars here serve as the base definition. When the launcher
    // calls `jobs.beginStart({ template })`, the entire template is replaced,
    // but secrets (above) remain accessible via secretRef.
    template: {
      containers: [
        {
          name: 'transcoder'
          image: codec.value
          env: [
            // Per-codec identifier — also overridden at execution time
            { name: 'CODEC', value: codec.key }
            // Secrets referenced from the job-level secrets array
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'azure-storage-connection-string' }
            { name: 'INTERNAL_API_KEY', secretRef: 'internal-api-key' }
          ]
          resources: {
            cpu: json(transcoderCpuCores)
            memory: '${transcoderMemoryGb}Gi'
          }
        }
      ]
    }
  }
}]

// ---------- Outputs ----------

output platformAppName string = platformApp.name
output hlsServerAppName string = hlsApp.name
output platformAppFqdn string = platformApp.properties.configuration.ingress.fqdn
output hlsServerFqdn string = hlsApp.properties.configuration.ingress.fqdn
output storageAccountName string = storageAccount.name
output containerEnvName string = containerEnv.name
// Names of created transcoder jobs (for reference/debugging)
output transcoderJobNames array = [for (codec, i) in filter(items(transcoderImages), item => !empty(item.value)): 'sg-transcode-${codec.key}']
