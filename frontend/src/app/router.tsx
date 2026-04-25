import { type ComponentType } from 'react';
import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import {
  FileCode2,
  LayoutDashboard,
  LogOut,
  Settings2,
  ShieldCheck,
  Users,
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

type LinkTo = '/' | '/users' | '/settings' | '/configs';

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
    { icon: FileCode2, label: 'Configs', to: '/configs' as const },
    { icon: Settings2, label: 'Settings', to: '/settings' as const },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[280px_1fr]">
        <aside className="border-b lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col">
            <div className="flex h-16 items-center px-6">
              <AppBrand />
            </div>

            <Separator />

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <nav className="space-y-1">
                {primaryLinks.map((link) => (
                  <SidebarLink key={link.to} icon={link.icon} label={link.label} to={link.to} />
                ))}
              </nav>
            </div>

            <Separator />

            <div className="space-y-1.5 p-4">
              <button
                className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition hover:bg-accent"
                onClick={async () => {
                  await logout();
                }}
                type="button"
              >
                <div className="flex size-9 items-center justify-center rounded-md bg-muted font-mono text-sm font-semibold text-primary">
                  {admin.username.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base text-foreground">{admin.username}</div>
                </div>
                <LogOut className="size-5 text-muted-foreground transition group-hover:text-foreground" />
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
      <div className="flex size-9 items-center justify-center rounded-md bg-primary/12 text-primary">
        <ShieldCheck className="size-5" />
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
  to,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  to: LinkTo;
}) {
  const base =
    'group flex items-center gap-3 rounded-md px-3 py-2.5 text-base text-muted-foreground transition hover:bg-accent hover:text-foreground';
  const active =
    'group flex items-center gap-3 rounded-md bg-[hsl(var(--primary)/0.08)] px-3 py-2.5 text-base font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]';

  return (
    <Link activeOptions={{ exact: true }} activeProps={{ className: active }} className={base} to={to}>
      <Icon className="size-5" />
      <span>{label}</span>
    </Link>
  );
}

function PillLink({ label, to }: { label: string; to: LinkTo }) {
  const base = 'shrink-0 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground';
  const active = 'shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground';
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
