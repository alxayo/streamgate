'use client';

import { Badge } from '@/components/ui/badge';

interface TokenStatusBadgeProps {
  isRevoked: boolean;
  redeemedAt: string | null;
  expiresAt: string;
}

export function TokenStatusBadge({ isRevoked, redeemedAt, expiresAt }: TokenStatusBadgeProps) {
  if (isRevoked) {
    return <Badge variant="destructive">Revoked</Badge>;
  }
  if (new Date(expiresAt) < new Date()) {
    return <Badge variant="secondary">Expired</Badge>;
  }
  if (redeemedAt) {
    return <Badge variant="success">Redeemed</Badge>;
  }
  return <Badge variant="warning">Unused</Badge>;
}
