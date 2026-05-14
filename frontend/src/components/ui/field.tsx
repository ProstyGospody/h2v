import * as React from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('flex w-full flex-col gap-4', className)} {...props} />;
}

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field"
      className={cn('group/field flex w-full flex-col gap-2 data-[invalid=true]:text-destructive', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn('group-data-[invalid=true]/field:text-destructive', className)}
      {...props}
    />
  );
}

function FieldError({ className, children, ...props }: React.ComponentProps<'p'>) {
  if (!children) return null;

  return (
    <p
      data-slot="field-error"
      className={cn('text-xs font-medium text-destructive', className)}
      {...props}
    >
      {children}
    </p>
  );
}

export { Field, FieldError, FieldGroup, FieldLabel };
