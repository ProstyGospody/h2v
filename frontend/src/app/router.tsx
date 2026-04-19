import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppProviders } from '@/app/providers';
import { LoginPage } from '@/features/auth/LoginPage';
import { useAuth } from '@/features/auth/useAuth';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { UsersPage } from '@/features/users/UsersPage';
import { ConfigsPage } from '@/features/configs/ConfigsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AuditPage } from '@/features/audit/AuditPage';
import { SubPage } from '@/features/subscription/SubPage';

function RootLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}

function ProtectedShell() {
  const { admin, ready } = useAuth();

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">Loading…</div>;
  }
  if (!admin) {
    return <LoginPage />;
  }

  const links = [
    { to: '/', label: 'Overview' },
    { to: '/users', label: 'Users' },
    { to: '/configs/xray', label: 'Configs' },
    { to: '/settings', label: 'Settings' },
    { to: '/audit', label: 'Audit' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 gap-6 px-4 py-4 lg:grid-cols-[220px_1fr]">
        <aside className="border border-white/10 bg-slate-900 p-4">
          <div className="mb-6">
            <div className="text-sm uppercase tracking-[0.12em] text-cyan-300">VPN Panel</div>
            <div className="mt-2 text-lg font-semibold">{admin.username}</div>
          </div>
          <nav className="space-y-2">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="block rounded-md border border-transparent px-3 py-2 text-sm text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white"
                activeProps={{ className: 'block rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-white' }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="overflow-hidden border border-white/10 bg-slate-900">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: ProtectedShell,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: DashboardPage,
});

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/users',
  component: UsersPage,
});

const configsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/configs/$core',
  component: ConfigsPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});

const auditRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/audit',
  component: AuditPage,
});

const publicSubscriptionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/u/$token',
  component: SubPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  publicSubscriptionRoute,
  appRoute.addChildren([dashboardRoute, usersRoute, configsRoute, settingsRoute, auditRoute]),
]);

export const router = createRouter({
  routeTree,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

