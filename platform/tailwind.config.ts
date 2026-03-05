import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Viewer Portal (Dark Theme) — PDR §14.1
        'cinema-black': '#1E1E1E',
        charcoal: '#2E2E2E',
        'slate-hover': '#3D3D3D',
        'accent-blue': '#3B82F6',
        'live-red': '#EF4444',
        // Admin Console (Light Theme) — PDR §14.1
        'admin-bg': '#F9FAFB',
        'admin-text': '#111827',
        'admin-body': '#374151',
        'status-active': '#22C55E',
        'status-unused': '#F59E0B',
        'status-revoked': '#EF4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-live': 'pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
