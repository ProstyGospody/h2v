import { useState, type ComponentType } from 'react';
import { Link, Outlet, createRootRoute, createRoute, createRouter, useRouterState } from '@tanstack/react-router';
import {
  FileCode2,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  UserCog,
  Users,
} from 'lucide-react';
import { AppProviders } from '@/app/providers';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { AdminsPage } from '@/features/admins/AdminsPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { useAuth } from '@/features/auth/useAuth';
import { ConfigsPage } from '@/features/configs/ConfigsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SubPage } from '@/features/subscription/SubPage';
import { UsersPage } from '@/features/users/UsersPage';
import { cn } from '@/lib/utils';

type LinkTo = '/' | '/users' | '/admins' | '/settings' | '/configs';

const primaryLinks: Array<{
  icon: ComponentType<{ className?: string }>;
  label: string;
  to: LinkTo;
}> = [
  { icon: LayoutDashboard, label: 'Dashboard', to: '/' },
  { icon: Users, label: 'Users', to: '/users' },
  { icon: FileCode2, label: 'Configs', to: '/configs' },
  { icon: UserCog, label: 'Admins', to: '/admins' },
  { icon: Settings2, label: 'Settings', to: '/settings' },
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
  const [navOpen, setNavOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentLink = primaryLinks.find((link) => link.to === pathname) ?? primaryLinks[0];

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-background text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (!admin) return <LoginPage />;

  return (
    <div className="min-h-screen bg-app-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] border-r border-border/55 bg-sidebar-panel lg:block">
        <SidebarBody admin={admin} logout={logout} />
      </aside>

      <main className="flex min-w-0 flex-col bg-transparent lg:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-background/90 px-4 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/70 lg:hidden">
          <Button
            aria-label="Open navigation"
            className="size-9"
            onClick={() => setNavOpen(true)}
            size="icon"
            variant="ghost"
          >
            <Menu className="size-5" />
          </Button>
          <AppBrand compact />
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {currentLink.label}
          </span>
        </header>

        <Outlet />
      </main>

      <Sheet onOpenChange={setNavOpen} open={navOpen}>
        <SheetContent className="w-70 bg-sidebar-panel p-0" side="left">
          <SidebarBody admin={admin} logout={logout} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SidebarBody({
  admin,
  logout,
  onNavigate,
}: {
  admin: { username: string; role?: string };
  logout: () => Promise<void> | void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex h-16 items-center px-5">
        <AppBrand />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="px-2 pb-2 t-label">Workspace</div>
        <nav className="space-y-0.5">
          {primaryLinks.map((link) => (
            <SidebarLink
              icon={link.icon}
              key={link.to}
              label={link.label}
              onClick={onNavigate}
              to={link.to}
            />
          ))}
        </nav>
      </div>

      <div className="border-t border-border/55 p-3">
        <div className="rounded-lg border border-border/60 bg-card p-2 shadow-sm">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted font-mono text-xs font-semibold text-foreground">
              {admin.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{admin.username}</div>
              <div className="truncate text-[11px] capitalize text-muted-foreground">
                {admin.role ?? 'admin'}
              </div>
            </div>
          </div>
          <Button
            className="mt-1 h-8 w-full justify-start gap-2 px-2 text-muted-foreground"
            onClick={async () => {
              onNavigate?.();
              await logout();
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

function AppBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center">
      <span
        className={cn(
          'font-serif italic leading-none text-accent-gradient',
          compact ? 'text-2xl' : 'text-[34px]',
        )}
      >
        h2v
      </span>
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
  const base =
    'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-[image:var(--gradient-accent-soft)] hover:text-foreground';
  const active =
    'group relative flex items-center gap-3 rounded-md bg-accent-gradient-soft px-3 py-2 text-sm font-medium text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-full before:bg-accent-gradient-vertical';

  return (
    <Link
      activeOptions={{ exact: true }}
      activeProps={{ className: active }}
      className={base}
      onClick={onClick}
      to={to}
    >
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
    </Link>
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
const adminsRoute = createRoute({ getParentRoute: () => appRoute, path: '/admins', component: AdminsPage });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage });
const publicSubscriptionRoute = createRoute({ getParentRoute: () => rootRoute, path: '/u/$token', component: SubPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  publicSubscriptionRoute,
  appRoute.addChildren([dashboardRoute, usersRoute, configsRoute, adminsRoute, settingsRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
