import { type ComponentType } from 'react';
import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import {
  FileCode2,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { AppProviders } from '@/app/providers';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { LoginPage } from '@/features/auth/LoginPage';
import { useAuth } from '@/features/auth/useAuth';
import { ConfigsPage } from '@/features/configs/ConfigsPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { SubPage } from '@/features/subscription/SubPage';
import { UsersPage } from '@/features/users/UsersPage';
import { cn } from '@/lib/utils';

type LinkTo = '/' | '/users' | '/settings' | '/configs/$core';

function RootLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}

function ProtectedShell() {
  const { admin, logout, ready } = useAuth();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (!admin) return <LoginPage />;

  const primaryLinks = [
    { icon: LayoutDashboard, label: 'Dashboard', to: '/' as const },
    { icon: Users, label: 'Users', to: '/users' as const },
    { icon: Settings2, label: 'Settings', to: '/settings' as const },
  ];

  const configLinks = [
    { icon: FileCode2, label: 'Xray', params: { core: 'xray' }, to: '/configs/$core' as const },
    { icon: Zap, label: 'Hysteria', params: { core: 'hysteria' }, to: '/configs/$core' as const },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[240px_1fr]">
        <aside className="border-b lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="flex h-14 items-center px-5">
              <AppBrand compact />
            </div>

            <Separator />

            <div className="flex-1 overflow-y-auto px-3 py-3">
              <nav className="space-y-0.5">
                {primaryLinks.map((link) => (
                  <SidebarLink key={link.to} icon={link.icon} label={link.label} to={link.to} />
                ))}
              </nav>

              <div className="mt-6">
                <div className="t-label px-3 pb-2">Configs</div>
                <div className="space-y-0.5">
                  {configLinks.map((link) => (
                    <SidebarLink
                      key={link.params.core}
                      icon={link.icon}
                      label={link.label}
                      params={link.params}
                      to={link.to}
                    />
                  ))}
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5 p-3">
              <button
                className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition hover:bg-accent"
                onClick={async () => {
                  await logout();
                }}
                type="button"
              >
                <div className="flex size-7 items-center justify-center rounded-md bg-muted font-mono text-xs font-semibold text-primary">
                  {admin.username.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{admin.username}</div>
                </div>
                <LogOut className="size-4 text-muted-foreground transition group-hover:text-foreground" />
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 bg-background">
          <div className="border-b px-4 py-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <AppBrand compact />
              <Button
                aria-label="Sign out"
                onClick={async () => {
                  await logout();
                }}
                size="icon"
                variant="ghost"
              >
                <LogOut />
              </Button>
            </div>
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
              {primaryLinks.map((link) => (
                <PillLink key={link.to} label={link.label} to={link.to} />
              ))}
              {configLinks.map((link) => (
                <PillLink key={link.params.core} label={link.label} params={link.params} to={link.to} />
              ))}
            </div>
          </div>

          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AppBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-7 items-center justify-center rounded-md bg-primary/12 text-primary">
        <ShieldCheck className="size-4" />
      </div>
      <span
        className={cn(
          'font-serif italic leading-none tracking-[-0.02em]',
          compact ? 'text-xl' : 'text-2xl',
        )}
      >
        MyPanel
      </span>
    </div>
  );
}

function SidebarLink({
  icon: Icon,
  label,
  params,
  to,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  params?: { core: string };
  to: LinkTo;
}) {
  const base =
    'group flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground';
  const active =
    'group flex items-center gap-3 rounded-md bg-[hsl(var(--primary)/0.08)] px-3 py-2 text-sm font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]';

  if (params) {
    return (
      <Link activeProps={{ className: active }} className={base} params={params} to="/configs/$core">
        <Icon className="size-4" />
        <span>{label}</span>
      </Link>
    );
  }
  return (
    <Link activeOptions={{ exact: true }} activeProps={{ className: active }} className={base} to={to}>
      <Icon className="size-4" />
      <span>{label}</span>
    </Link>
  );
}

function PillLink({ label, params, to }: { label: string; params?: { core: string }; to: LinkTo }) {
  const base = 'shrink-0 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground';
  const active = 'shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground';
  if (params) {
    return (
      <Link activeProps={{ className: active }} className={base} params={params} to="/configs/$core">
        {label}
      </Link>
    );
  }
  return (
    <Link activeOptions={{ exact: true }} activeProps={{ className: active }} className={base} to={to}>
      {label}
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
const configsRoute = createRoute({ getParentRoute: () => appRoute, path: '/configs/$core', component: ConfigsPage });
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
