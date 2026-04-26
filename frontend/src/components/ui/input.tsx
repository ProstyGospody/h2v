import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-transparent bg-muted/65 px-3 py-1 text-sm text-foreground shadow-xs transition-colors outline-none selection:bg-primary/25',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'placeholder:text-muted-foreground/65',
        'hover:bg-muted',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:bg-background',
        'aria-invalid:border-destructive/60 aria-invalid:ring-2 aria-invalid:ring-destructive/30',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
