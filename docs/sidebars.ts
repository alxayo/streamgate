import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  userGuideSidebar: [
    {
      type: 'doc',
      id: 'user-guide/overview',
      label: 'Overview',
    },
    {
      type: 'doc',
      id: 'user-guide/quick-start',
      label: '⚡ Quick Start (5 min)',
    },
    {
      type: 'category',
      label: 'Installation',
      items: [
        'user-guide/installation/prerequisites',
        'user-guide/installation/manual-setup',
        'user-guide/installation/docker-setup',
      ],
    },
    {
      type: 'doc',
      id: 'user-guide/viewer-portal',
      label: 'Viewer Portal',
    },
    {
      type: 'doc',
      id: 'user-guide/admin-console',
      label: 'Admin Console',
    },
    {
      type: 'doc',
      id: 'user-guide/streaming-with-ffmpeg',
      label: 'Live Streaming with FFmpeg',
    },
    {
      type: 'doc',
      id: 'user-guide/live-streaming-tuning',
      label: '🎛️ Live Streaming Tuning',
    },
    {
      type: 'doc',
      id: 'user-guide/configuration',
      label: 'Configuration Reference',
    },
    {
      type: 'doc',
      id: 'user-guide/troubleshooting',
      label: 'Troubleshooting',
    },
  ],

  developerGuideSidebar: [
    {
      type: 'doc',
      id: 'developer-guide/architecture',
      label: 'Architecture Overview',
    },
    {
      type: 'category',
      label: 'Services',
      items: [
        'developer-guide/platform-app',
        'developer-guide/hls-server',
        'developer-guide/shared-library',
      ],
    },
    {
      type: 'doc',
      id: 'developer-guide/api-reference',
      label: 'API Reference',
    },
    {
      type: 'doc',
      id: 'developer-guide/data-model',
      label: 'Data Model',
    },
    {
      type: 'doc',
      id: 'developer-guide/security',
      label: 'Security',
    },
    {
      type: 'doc',
      id: 'developer-guide/deployment',
      label: 'Deployment',
    },
    {
      type: 'doc',
      id: 'developer-guide/contributing',
      label: 'Contributing',
    },
  ],
};

export default sidebars;
