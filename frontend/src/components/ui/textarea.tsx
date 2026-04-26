import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-transparent bg-muted/65 px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-colors selection:bg-ring/25',
        'placeholder:text-muted-foreground/65',
        'hover:bg-muted',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring/45 focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:bg-background',
        'aria-invalid:border-destructive/60 aria-invalid:ring-2 aria-invalid:ring-destructive/30',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
