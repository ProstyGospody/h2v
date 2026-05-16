import { useId, useState } from 'react';
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
  icon: LucideIcon;
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
    <SidebarProvider defaultOpen className="min-h-screen min-w-0 overflow-x-hidden bg-app-background text-foreground">
      <Sidebar>
        <SidebarBody admin={admin} logout={logout} />
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
            <Menu aria-hidden="true" />
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
        <SheetContent className="w-70 bg-sidebar p-0 text-sidebar-foreground" side="left">
          <SidebarProvider open>
            <SidebarBody admin={admin} logout={logout} onNavigate={() => setNavOpen(false)} />
          </SidebarProvider>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  );
}

function SidebarBody({
  admin,
  logout,
  onNavigate,
}: {
  admin: { username: string };
  logout: () => Promise<void> | void;
  onNavigate?: () => void;
}) {
  const { locale, t } = useI18n();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
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
          'relative flex h-[72px] items-center border-b border-sidebar-border/70',
          collapsed ? 'flex-col justify-center gap-1 px-2' : 'justify-between px-5',
        )}
      >
        <AppBrand compact={collapsed} iconOnly={collapsed} />
      </SidebarHeader>

      <SidebarContent className="px-4 py-5">
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.workspace')}</SidebarGroupLabel>
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

        <SidebarGroup className="mt-7">
          <SidebarGroupLabel>{t('nav.services')}</SidebarGroupLabel>
          <ServiceStatusPanel collapsed={collapsed} items={serviceStatuses} />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className={cn('border-t border-sidebar-border/70', collapsed ? 'px-3 py-3' : 'px-5 py-4')}>
        <div className={cn('flex', collapsed ? 'flex-col items-center gap-2' : 'items-center gap-2.5')}>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent font-mono text-xs font-semibold text-sidebar-accent-foreground">
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
            <LogOut aria-hidden="true" />
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
    <div data-slot="sidebar-service-list" className="flex flex-col gap-1 px-1">
      <svg aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
        <defs>
          <linearGradient id={gradientId} x1="4" x2="20" y1="4" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--icon-gradient-start)" />
            <stop offset="0.45" stopColor="var(--icon-gradient-mid)" />
            <stop offset="1" stopColor="var(--icon-gradient-end)" />
          </linearGradient>
        </defs>
      </svg>
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <div
            data-slot="sidebar-service-item"
            className="group/service relative flex h-11 items-center gap-2.5 rounded-md px-1.5 py-1 text-sidebar-foreground/75 transition-[background-color,color] duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            key={item.label}
            title={collapsed ? `${item.label}: ${item.value}` : undefined}
          >
            {item.logo || Icon ? (
              <span
                data-logo={item.logo ? item.logo : undefined}
                data-slot="sidebar-service-icon"
                className="flex size-8 shrink-0 items-center justify-center rounded-md"
              >
                {item.logo ? (
                  <CoreLogo className={cn(item.logo === 'hysteria' ? 'h-7 w-9' : 'size-7')} core={item.logo} />
                ) : Icon ? (
                  <Icon stroke={`url(#${gradientId})`} strokeWidth={2.25} />
                ) : null}
              </span>
            ) : null}
            <span data-slot="sidebar-service-label" className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium leading-5 text-current">
                {item.label}
              </span>
            </span>
            {item.showValue ? (
              <span data-slot="sidebar-service-value" className="shrink-0 font-mono text-[11px] text-sidebar-foreground/55 group-hover/service:text-sidebar-accent-foreground/70">
                {item.value}
              </span>
            ) : null}
            {item.showIndicator ? (
              <span
                data-slot="sidebar-service-dot"
                aria-label={item.value}
                className={cn(
                  'size-2 shrink-0 rounded-full ring-2',
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
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  to: LinkTo;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const isActive = pathname === to;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
        <Link
          aria-current={isActive ? 'page' : undefined}
          onClick={onClick}
          to={to}
        >
          <span
            data-slot="sidebar-menu-icon"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-current transition-colors group-data-[active=true]/menu-button:bg-sidebar-primary/10 group-data-[active=true]/menu-button:text-sidebar-primary"
          >
            <Icon aria-hidden="true" />
          </span>
          <span data-slot="sidebar-menu-label" className="min-w-0 truncate">{label}</span>
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
