import { useEffect, useState } from 'react';
import { Link, Outlet, createRootRoute, createRoute, createRouter, useRouterState } from '@tanstack/react-router';
import {
  BadgeCheck,
  Check,
  Crown,
  FileCode2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Settings2,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AppProviders } from '@/app/providers';
import { BrandLogo } from '@/components/brand-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useI18n } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';

type LinkTo = '/' | '/users' | '/settings' | '/configs';
type OwnerIconId = 'admin' | 'owner' | 'key' | 'verified' | 'user';

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

const ownerIconOptions: Array<{ icon: LucideIcon; id: OwnerIconId; label: string }> = [
  { icon: ShieldCheck, id: 'admin', label: 'Admin' },
  { icon: Crown, id: 'owner', label: 'Owner' },
  { icon: KeyRound, id: 'key', label: 'Root' },
  { icon: BadgeCheck, id: 'verified', label: 'Verified' },
  { icon: UserRound, id: 'user', label: 'User' },
];

const ownerIconFallback = ownerIconOptions[0];

function ownerIconStorageKey(username: string) {
  return `h2v-owner-icon:${username}`;
}

function readOwnerIcon(username: string): OwnerIconId {
  if (typeof window === 'undefined') return ownerIconFallback.id;
  try {
    const stored = window.localStorage.getItem(ownerIconStorageKey(username));
    return ownerIconOptions.some((option) => option.id === stored)
      ? (stored as OwnerIconId)
      : ownerIconFallback.id;
  } catch {
    return ownerIconFallback.id;
  }
}

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
  const { t } = useI18n();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const [ownerIconId, setOwnerIconId] = useState<OwnerIconId>(() => readOwnerIcon(admin.username));
  const ownerIcon = ownerIconOptions.find((option) => option.id === ownerIconId) ?? ownerIconFallback;
  const OwnerIcon = ownerIcon.icon;

  useEffect(() => {
    setOwnerIconId(readOwnerIcon(admin.username));
  }, [admin.username]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(ownerIconStorageKey(admin.username), ownerIconId);
    } catch {
      // The selected icon is cosmetic; ignore storage failures in restricted browsers.
    }
  }, [admin.username, ownerIconId]);

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
      </SidebarContent>

      <SidebarFooter className={cn('border-t border-sidebar-border/70', collapsed ? 'px-3 py-3' : 'px-5 py-4')}>
        <div className={cn('flex', collapsed ? 'flex-col items-center gap-2' : 'items-center gap-2.5')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Change owner icon"
                className="flex size-9 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground transition-colors hover:[background-image:var(--sidebar-action-hover)]"
                title={ownerIcon.label}
                type="button"
              >
                <OwnerIcon aria-hidden="true" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={collapsed ? 'center' : 'start'} side="top">
              {ownerIconOptions.map((option) => {
                const Icon = option.icon;
                const selected = ownerIconId === option.id;

                return (
                  <DropdownMenuItem
                    className={cn(selected && '[background-image:var(--gradient-accent-soft)] text-foreground')}
                    key={option.id}
                    onSelect={() => setOwnerIconId(option.id)}
                  >
                    <Icon />
                    <span className="flex-1">{option.label}</span>
                    {selected ? <Check className="ml-auto" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
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
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-current transition-colors group-data-[active=true]/menu-button:text-primary-foreground"
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
