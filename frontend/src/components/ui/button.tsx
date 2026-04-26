import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:ring-offset-0 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.3),0_4px_18px_-4px_hsl(var(--primary)/0.45)] hover:brightness-110 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.4),0_6px_22px_-4px_hsl(var(--primary)/0.55)]',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-accent',
        outline:
          'border border-primary/30 bg-transparent text-primary hover:bg-primary/10 hover:border-primary/50',
        ghost:
          'text-muted-foreground hover:bg-accent hover:text-foreground',
        destructive:
          'bg-destructive text-destructive-foreground shadow-[0_0_0_1px_hsl(var(--destructive)/0.3)] hover:brightness-110',
        link: 'text-primary underline-offset-4 hover:underline px-0 h-auto active:translate-y-0',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
