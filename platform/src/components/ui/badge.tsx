import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent-blue focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent-blue text-white',
        secondary: 'border-transparent bg-charcoal text-white',
        destructive: 'border-transparent bg-live-red text-white',
        outline: 'text-white border-gray-600',
        success: 'border-transparent bg-status-active text-white',
        warning: 'border-transparent bg-status-unused text-white',
        live: 'border-transparent bg-live-red text-white animate-pulse-live',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
