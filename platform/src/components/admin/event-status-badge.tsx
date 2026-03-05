'use client';

import { Badge } from '@/components/ui/badge';

interface EventStatusBadgeProps {
  isActive: boolean;
  isArchived: boolean;
}

export function EventStatusBadge({ isActive, isArchived }: EventStatusBadgeProps) {
  if (isArchived) {
    return <Badge variant="secondary">Archived</Badge>;
  }
  if (isActive) {
    return <Badge variant="success">Active</Badge>;
  }
  return <Badge variant="destructive">Inactive</Badge>;
}
