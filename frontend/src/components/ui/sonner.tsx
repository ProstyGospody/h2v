import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast rounded-md border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-[0_16px_48px_-12px_rgba(0,0,0,0.6)]',
          title: 'text-sm font-medium',
          description: 'text-xs text-muted-foreground',
          actionButton: 'rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground',
          cancelButton: 'rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground',
          success: 'border-success/30',
          error: 'border-destructive/35',
          warning: 'border-warning/30',
          info: 'border-border',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
