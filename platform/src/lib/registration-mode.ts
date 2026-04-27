import { prisma } from '@/lib/prisma';

export type RegistrationMode = 'open' | 'approval' | 'disabled';

/**
 * Fetches the current creator registration mode from SystemSettings.
 * Returns 'open' if no setting exists yet.
 */
export async function getRegistrationMode(): Promise<RegistrationMode> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { creatorRegistrationMode: true },
  });

  const mode = settings?.creatorRegistrationMode;
  if (mode === 'approval' || mode === 'disabled') return mode;
  return 'open';
}
