import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="bottom-right"
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            'group toast rounded-lg border border-border/45 bg-popover px-4 py-3 text-sm text-popover-foreground shadow-overlay',
          title: 'text-sm font-medium',
          description: 'text-xs text-muted-foreground',
          actionButton:
            'rounded-md bg-accent-gradient px-2.5 py-1 text-xs font-medium text-white',
          cancelButton:
            'rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground',
          success: 'border-success/35 [&_[data-icon]>svg]:text-success',
          error: 'border-destructive/40 [&_[data-icon]>svg]:text-destructive',
          warning: 'border-warning/35 [&_[data-icon]>svg]:text-warning',
          info: 'border-border/45',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
