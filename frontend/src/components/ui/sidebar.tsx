import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  state: 'collapsed' | 'expanded';
  toggleSidebar: () => void;
};

const SIDEBAR_TRANSITION_MS = 220;

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

const sidebarMenuButtonVariants = cva(
  [
    'group/menu-button peer/menu-button relative flex w-full min-w-0 items-center overflow-hidden rounded-md text-left outline-none ring-sidebar-ring transition-[background-color,color,box-shadow] duration-150',
    'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/35',
    'data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground data-[active=true]:ring-1 data-[active=true]:ring-sidebar-ring/25',
    'before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-r-full before:bg-transparent data-[active=true]:before:bg-sidebar-ring',
    "disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      size: {
        default: 'h-11 gap-2.5 px-2.5 text-sm',
        sm: 'h-9 gap-2 px-2 text-xs',
        lg: 'h-12 gap-3 px-3 text-sm',
      },
      variant: {
        default: '',
        outline:
          'bg-sidebar/35 ring-1 ring-sidebar-border hover:bg-sidebar-accent hover:ring-sidebar-ring/25',
      },
    },
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
  },
);

function useSidebar() {
  const context = React.useContext(SidebarContext);

  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }

  return context;
}

function SidebarProvider({
  children,
  className,
  defaultOpen = true,
  onOpenChange,
  open: openProp,
  style,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const state = open ? 'expanded' : 'collapsed';

  const setOpen = React.useCallback(
    (value: boolean) => {
      onOpenChange?.(value);
      if (openProp === undefined) setUncontrolledOpen(value);
    },
    [onOpenChange, openProp],
  );

  const value = React.useMemo<SidebarContextValue>(
    () => ({
      open,
      setOpen,
      state,
      toggleSidebar: () => setOpen(!open),
    }),
    [open, setOpen, state],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        data-state={state}
        style={{
          '--sidebar-width': '17.5rem',
          '--sidebar-width-icon': '5.25rem',
          '--sidebar-transition-duration': `${SIDEBAR_TRANSITION_MS}ms`,
          ...style,
        } as React.CSSProperties}
        className={cn('group/sidebar-wrapper min-h-screen min-w-0', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({ className, children, ...props }: React.ComponentProps<'aside'>) {
  const { state } = useSidebar();

  return (
    <div
      data-collapsible={state === 'collapsed' ? 'icon' : ''}
      data-slot="sidebar-shell"
      data-state={state}
      className="hidden shrink-0 lg:block"
    >
      <aside
        data-slot="sidebar"
        data-state={state}
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden overflow-hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex',
          className,
        )}
        {...props}
      >
        {children}
      </aside>
    </div>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  const { state } = useSidebar();

  return (
    <main
      data-slot="sidebar-inset"
      data-state={state}
      className={cn(
        'flex min-w-0 flex-1 flex-col overflow-x-hidden bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex shrink-0 items-center', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('flex shrink-0 flex-col', className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('flex flex-col', className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn('px-2 pb-3 t-label text-sidebar-foreground/50', className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'nav'>) {
  return <nav data-slot="sidebar-menu" className={cn('flex flex-col gap-2', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-menu-item" className={cn('min-w-0', className)} {...props} />;
}

function SidebarMenuButton({
  asChild = false,
  className,
  isActive = false,
  size = 'default',
  tooltip,
  variant = 'default',
  ...props
}: React.ComponentProps<'a'> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const Comp = asChild ? Slot : 'a';

  return (
    <Comp
      data-active={isActive}
      data-slot="sidebar-menu-button"
      title={collapsed ? tooltip : undefined}
      className={cn(sidebarMenuButtonVariants({ size, variant }), className)}
      {...props}
    />
  );
}

function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { open, toggleSidebar } = useSidebar();
  const Icon = open ? ChevronLeft : ChevronRight;

  return (
    <Button
      aria-label={open ? 'Collapse navigation' : 'Expand navigation'}
      className={cn('hidden shrink-0 text-muted-foreground lg:inline-flex', !open && 'size-7', className)}
      onClick={toggleSidebar}
      size="icon-sm"
      title={open ? 'Collapse navigation' : 'Expand navigation'}
      type="button"
      variant="ghost"
      {...props}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  sidebarMenuButtonVariants,
  useSidebar,
};
