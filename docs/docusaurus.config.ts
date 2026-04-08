import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'StreamGate',
  tagline: 'Ticket-gated video streaming platform',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://alxayo.github.io',
  baseUrl: '/streamgate/',

  organizationName: 'alxayo',
  projectName: 'streamgate',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
           editUrl: 'https://github.com/alxayo/streamgate/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'StreamGate',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'userGuideSidebar',
          position: 'left',
          label: 'User Guide',
        },
        {
          type: 'docSidebar',
          sidebarId: 'developerGuideSidebar',
          position: 'left',
          label: 'Developer Guide',
        },
        {
           href: 'https://github.com/alxayo/streamgate',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'User Guide',
          items: [
            {label: 'Quick Start', to: '/docs/user-guide/quick-start'},
            {label: 'Viewer Portal', to: '/docs/user-guide/viewer-portal'},
            {label: 'Admin Console', to: '/docs/user-guide/admin-console'},
          ],
        },
        {
          title: 'Developer Guide',
          items: [
            {label: 'Architecture', to: '/docs/developer-guide/architecture'},
            {label: 'API Reference', to: '/docs/developer-guide/api-reference'},
            {label: 'Deployment', to: '/docs/developer-guide/deployment'},
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
               href: 'https://github.com/alxayo/streamgate',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} StreamGate. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'powershell', 'nginx', 'yaml', 'docker'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
