/**
 * Checkbox Component (shadcn/ui pattern)
 * =======================================
 * A simple checkbox input that follows the shadcn/ui component conventions.
 * Supports both standard onChange and a convenience onCheckedChange callback
 * that passes a boolean directly (no need to unwrap e.target.checked).
 *
 * Usage:
 *   <Checkbox checked={value} onCheckedChange={(checked) => setValue(checked)} />
 */
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Convenience callback — receives `true` or `false` directly */
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onCheckedChange, ...props }, ref) => {
    return (
      <input
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500',
          className,
        )}
        ref={ref}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
    );
  },
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
