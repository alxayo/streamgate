// =========================================================================
// Initial Admin User Seeder
// =========================================================================
// On first startup (when no AdminUser records exist in the database), this
// module creates a Super Admin user from two environment variables:
//   - INITIAL_ADMIN_EMAIL: the email address for the first admin
//   - INITIAL_ADMIN_PASSWORD: the password (must be >= 12 characters)
//
// The created user has mustSetup2FA=true, so they'll be prompted to set up
// their authenticator app on first login.
//
// This function is called from the login route handler and is safe to call
// multiple times (it's a no-op after the first run thanks to the _seeded flag).
// =========================================================================

import bcrypt from 'bcrypt';
import { prisma } from './prisma';
import { env } from './env';
import { MIN_PASSWORD_LENGTH } from '@streaming/shared';

// Singleton flag: ensures seeding only runs once per process, even if
// the login route is hit multiple times concurrently.
let _seeded = false;

/**
 * Seeds the first Super Admin user from environment variables if no admin users exist.
 * Called on app startup — safe to call multiple times (no-op after first run).
 */
export async function seedInitialAdmin(): Promise<void> {
  if (_seeded) return;
  _seeded = true;

  const email = env.INITIAL_ADMIN_EMAIL;
  const password = env.INITIAL_ADMIN_PASSWORD;

  if (!email || !password) return;

  // Only seed if no admin users exist
  const existingCount = await prisma.adminUser.count();
  if (existingCount > 0) return;

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.warn(
      `[admin-seed] INITIAL_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. Skipping seed.`
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'SUPER_ADMIN',
      mustSetup2FA: true,
      isActive: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: 'admin_seeded',
      details: JSON.stringify({ email: email.toLowerCase().trim() }),
      ipAddress: 'system',
    },
  });

  console.log(`[admin-seed] Initial Super Admin created: ${email.toLowerCase().trim()}`);
}
