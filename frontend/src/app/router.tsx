import { useId, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, createRootRoute, createRoute, createRouter, useRouterState } from '@tanstack/react-router';
import {
  FileCode2,
  LayoutDashboard,
  LogOut,
  Menu,
  Timer,
  Settings2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AppProviders } from '@/app/providers';
import { BrandLogo } from '@/components/brand-logo';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
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
  useSidebar,
} from '@/components/ui/sidebar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { LoginPage } from '@/features/auth/LoginPage';
import { useAuth } from '@/features/auth/useAuth';
import { ConfigsPage } from '@/features/configs/ConfigsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SubPage } from '@/features/subscription/SubPage';
import { UsersPage } from '@/features/users/UsersPage';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import type { OverviewStats } from '@/shared/api/types';
import { useI18n, type Translate } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';
import { formatDurationCompact } from '@/shared/lib/format';

type LinkTo = '/' | '/users' | '/settings' | '/configs';
type StatusTone = 'ok' | 'warn' | 'idle';

const primaryLinks: Array<{
  icon: ComponentType<{ className?: string }>;
  labelKey: TranslationKey;
  to: LinkTo;
}> = [
  { icon: LayoutDashboard, labelKey: 'nav.dashboard', to: '/' },
  { icon: Users, labelKey: 'nav.users', to: '/users' },
  { icon: FileCode2, labelKey: 'nav.configs', to: '/configs' },
  { icon: Settings2, labelKey: 'nav.settings', to: '/settings' },
];

function RootLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}

function ProtectedShell() {
  const { admin, logout, ready } = useAuth();
  const { t } = useI18n();
  const [navOpen, setNavOpen] = useState(false);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-background text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }
  if (!admin) return <LoginPage />;

  return (
    <SidebarProvider defaultOpen>
      <div className="min-h-screen min-w-0 overflow-x-hidden bg-app-background text-foreground">
        <Sidebar>
          <SidebarBody admin={admin} logout={logout} showToggle />
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-background/90 px-4 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/70 lg:hidden">
            <Button
              aria-label={t('shell.openNavigation')}
              className="size-9"
              onClick={() => setNavOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Menu className="size-5" />
            </Button>
            <AppBrand compact />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle compact />
              <LanguageSwitcher compact />
            </div>
          </header>

          <Outlet />
        </SidebarInset>

        <Sheet onOpenChange={setNavOpen} open={navOpen}>
          <SheetContent className="w-70 bg-sidebar-panel p-0" side="left">
            <SidebarProvider open>
              <SidebarBody admin={admin} logout={logout} onNavigate={() => setNavOpen(false)} />
            </SidebarProvider>
          </SheetContent>
        </Sheet>
      </div>
    </SidebarProvider>
  );
}

function SidebarBody({
  admin,
  logout,
  onNavigate,
  showToggle = false,
}: {
  admin: { username: string };
  logout: () => Promise<void> | void;
  onNavigate?: () => void;
  showToggle?: boolean;
}) {
  const { locale, t } = useI18n();
  const { open } = useSidebar();
  const collapsed = !open;
  const overview = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiClient.request<OverviewStats>('/stats/overview'),
    refetchInterval: 10_000,
  });
  const serviceStatuses = [
    {
      label: t('shell.uptime'),
      icon: Timer,
      value: formatDurationCompact(overview.data?.uptime_seconds, locale),
      showIndicator: false,
      showValue: true,
    },
    {
      label: 'Xray',
      logo: 'xray' as const,
      tone: serviceTone(overview.data?.xray_status, overview.isError),
      value: serviceStatusLabel(overview.data?.xray_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
      showValue: false,
    },
    {
      label: 'Hysteria 2',
      logo: 'hysteria' as const,
      tone: serviceTone(overview.data?.hysteria_status, overview.isError),
      value: serviceStatusLabel(overview.data?.hysteria_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
      showValue: false,
    },
  ];

  return (
    <div className="flex h-dvh flex-col">
      <SidebarHeader
        className={cn(
          'relative flex h-[72px] items-center border-b border-border/45',
          collapsed ? 'flex-col justify-center gap-1 px-2' : 'justify-between px-5',
        )}
      >
        <AppBrand compact={collapsed} iconOnly={collapsed} />
        {showToggle ? <SidebarTrigger /> : null}
      </SidebarHeader>

      <SidebarContent className={cn(collapsed ? 'px-3 py-4' : 'px-4 py-5')}>
        <SidebarGroup>
          {!collapsed ? <SidebarGroupLabel>{t('nav.workspace')}</SidebarGroupLabel> : null}
          <SidebarMenu>
            {primaryLinks.map((link) => (
              <SidebarLink
                icon={link.icon}
                key={link.to}
                label={t(link.labelKey)}
                onClick={onNavigate}
                to={link.to}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className={cn(collapsed ? 'mt-5' : 'mt-7')}>
          {!collapsed ? <SidebarGroupLabel>{t('nav.services')}</SidebarGroupLabel> : null}
          <ServiceStatusPanel collapsed={collapsed} items={serviceStatuses} />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className={cn('border-t border-border/55', collapsed ? 'px-3 py-3' : 'px-5 py-4')}>
        <div className={cn('flex', collapsed ? 'flex-col items-center gap-2' : 'items-center gap-2.5')}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/55 bg-muted/45 font-mono text-xs font-semibold text-foreground">
            {admin.username.slice(0, 1).toUpperCase()}
          </div>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium leading-5 text-foreground">{admin.username}</div>
            </div>
          ) : null}
          <ThemeToggle className="shrink-0 text-muted-foreground" compact />
          <LanguageSwitcher className="shrink-0 text-muted-foreground" compact />
          <Button
            aria-label={t('nav.signOut')}
            className="size-8 shrink-0 text-muted-foreground"
            onClick={async () => {
              onNavigate?.();
              await logout();
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </div>
  );
}

function ServiceStatusPanel({
  collapsed = false,
  items,
}: {
  collapsed?: boolean;
  items: Array<{
    icon?: LucideIcon;
    label: string;
    logo?: CoreLogoName;
    showIndicator?: boolean;
    showValue?: boolean;
    tone?: StatusTone;
    value: string;
  }>;
}) {
  const gradientId = `service-icon-${useId().replace(/:/g, '')}`;

  return (
    <div className={cn(collapsed ? 'flex flex-col gap-2' : 'flex flex-col gap-1 px-1')}>
      <svg aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
        <defs>
          <linearGradient id={gradientId} x1="4" x2="20" y1="4" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff7b8" />
            <stop offset="0.45" stopColor="#e9fff7" />
            <stop offset="1" stopColor="#f08a24" />
          </linearGradient>
        </defs>
      </svg>
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <div
            className={cn(
              'relative flex items-center rounded-lg transition-colors hover:bg-muted/25',
              collapsed ? 'h-11 justify-center px-0' : 'gap-2.5 px-1 py-1.5',
            )}
            key={item.label}
            title={collapsed ? `${item.label}: ${item.value}` : undefined}
          >
            {item.logo || Icon ? (
              <span className={cn('flex shrink-0 items-center justify-center', collapsed ? 'size-9' : 'size-7')}>
                {item.logo ? (
                  <CoreLogo className={collapsed ? 'size-7' : 'size-6'} core={item.logo} />
                ) : Icon ? (
                  <Icon className="size-5" stroke={`url(#${gradientId})`} strokeWidth={2.25} />
                ) : null}
              </span>
            ) : null}
            {!collapsed ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-5 text-foreground">
                  {item.label}
                </span>
              </span>
            ) : null}
            {item.showValue && !collapsed ? (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.value}</span>
            ) : null}
            {item.showIndicator ? (
              <span
                aria-label={item.value}
                className={cn(
                  'size-2 shrink-0 rounded-full ring-2',
                  collapsed && 'absolute right-2 top-2',
                  serviceDotTone(item.tone ?? 'idle'),
                )}
                title={item.value}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function serviceTone(value: string | undefined, isError: boolean): StatusTone {
  if (isError) return 'warn';
  if (!value) return 'idle';
  return value.toLowerCase().startsWith('fail') ? 'warn' : 'ok';
}

function serviceStatusLabel(value: string | undefined, isLoading: boolean, isError: boolean, t: Translate): string {
  if (isError) return t('common.issue');
  if (isLoading && !value) return t('common.syncing');
  if (!value) return t('common.unknown');
  return value.toLowerCase().startsWith('fail') ? t('common.issue') : t('common.ok');
}

function serviceDotTone(tone: StatusTone): string {
  if (tone === 'ok') return 'bg-success ring-success/15';
  if (tone === 'warn') return 'bg-warning ring-warning/15';
  return 'bg-muted-foreground ring-muted-foreground/10';
}

function AppBrand({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center', iconOnly && 'justify-center')}>
      <BrandLogo className={cn(iconOnly ? 'h-10 w-10' : compact ? 'h-10 w-20' : 'h-12 w-24')} />
    </div>
  );
}

function SidebarLink({
  icon: Icon,
  label,
  onClick,
  to,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  to: LinkTo;
}) {
  const { open } = useSidebar();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = pathname === to;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link
          onClick={onClick}
          to={to}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md transition-colors group-hover:bg-background/20">
            <Icon className="size-5 shrink-0" />
          </span>
          {open ? <span className="min-w-0 truncate">{label}</span> : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: ProtectedShell });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: '/', component: DashboardPage });
const usersRoute = createRoute({ getParentRoute: () => appRoute, path: '/users', component: UsersPage });
const configsRoute = createRoute({ getParentRoute: () => appRoute, path: '/configs', component: ConfigsPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage });
const publicSubscriptionRoute = createRoute({ getParentRoute: () => rootRoute, path: '/u/$token', component: SubPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  publicSubscriptionRoute,
  appRoute.addChildren([dashboardRoute, usersRoute, configsRoute, settingsRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
