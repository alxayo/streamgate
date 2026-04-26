'use client';

// =========================================================================
// Admin Layout (Shared Chrome)
// =========================================================================
// Wraps all /admin/* pages with the sidebar navigation and mobile header.
// Special cases:
//   - /admin/login and /admin/setup-2fa render WITHOUT the sidebar
//   - Legacy auth mode shows an amber migration banner at the top
//
// The layout fetches the session state on mount to detect legacy mode
// and conditionally display the migration banner.
// =========================================================================

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, AlertTriangle } from 'lucide-react';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLegacy, setIsLegacy] = useState(false);

  // Auto-close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Close sidebar on Escape key
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, []);

  // Check for legacy auth mode
  useEffect(() => {
    fetch('/api/admin/session')
      .then(res => res.json())
      .then(data => setIsLegacy(!!data.isLegacy))
      .catch(() => {});
  }, []);

  // Login page and 2FA setup render without the sidebar chrome
  if (pathname === '/admin/login' || pathname === '/admin/setup-2fa') {
    return <>{children}</>;
  }

  // Middleware guarantees authentication for all other /admin/* routes
  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header with hamburger */}
        <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 -ml-1 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold text-gray-900">StreamGate</h1>
        </header>

        {/* Legacy auth migration banner */}
        {isLegacy && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              Legacy authentication active. Set <code className="text-xs bg-amber-100 px-1 rounded">INITIAL_ADMIN_EMAIL</code> and{' '}
              <code className="text-xs bg-amber-100 px-1 rounded">INITIAL_ADMIN_PASSWORD</code> env vars to create admin accounts with 2FA.{' '}
              <Link href="/admin/users" className="underline font-medium">Manage Users</Link>
            </p>
          </div>
        )}

        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
