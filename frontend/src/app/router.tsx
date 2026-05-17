import { useEffect, useState } from 'react';
import { Link, Outlet, createRootRoute, createRoute, createRouter, useRouterState } from '@tanstack/react-router';
import {
  Check,
  FileCode2,
  LayoutDashboard,
  LogOut,
  Menu,
  Save,
  Settings2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppProviders } from '@/app/providers';
import { BrandLogo } from '@/components/brand-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
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
import { ApiError } from '@/shared/api/client';
import type { Admin, AdminIcon } from '@/shared/api/types';
import { useI18n } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';

type LinkTo = '/' | '/users' | '/settings' | '/configs';

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

const profileIconOptions: Array<{ id: AdminIcon; label: string; src: string }> = [
  { id: 'robot', label: 'Robot', src: '/profile-icons/robot.svg' },
  { id: 'dino', label: 'Dino', src: '/profile-icons/dino.svg' },
  { id: 'astronaut', label: 'Astronaut', src: '/profile-icons/astronaut.svg' },
  { id: 'rocket', label: 'Rocket', src: '/profile-icons/rocket.svg' },
  { id: 'crown', label: 'Crown', src: '/profile-icons/crown.svg' },
];

const profileIconFallback = profileIconOptions[0]!;

function profileIconMeta(icon: AdminIcon | undefined) {
  return profileIconOptions.find((option) => option.id === icon) ?? profileIconFallback;
}

function RootLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}

function ProtectedShell() {
  const { admin, logout, ready, updateAdmin } = useAuth();
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
        <SidebarBody admin={admin} logout={logout} updateAdmin={updateAdmin} />
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
            <SidebarBody
              admin={admin}
              logout={logout}
              onNavigate={() => setNavOpen(false)}
              updateAdmin={updateAdmin}
            />
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
  updateAdmin,
}: {
  admin: Admin;
  logout: () => Promise<void> | void;
  onNavigate?: () => void;
  updateAdmin: (input: { icon: AdminIcon; password?: string; username: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const [profileOpen, setProfileOpen] = useState(false);
  const profileIcon = profileIconMeta(admin.icon);

  return (
    <div className="flex h-dvh flex-col lg:h-full lg:p-5">
      <SidebarHeader
        className={cn(
          'relative flex h-[72px] items-center justify-center lg:h-24',
          collapsed ? 'px-2' : 'px-5 lg:px-0',
        )}
      >
        <AppBrand compact={collapsed} iconOnly={collapsed} />
      </SidebarHeader>

      <SidebarContent className="px-4 pb-5 pt-8 lg:px-0 lg:pt-7">
        <SidebarGroup>
          <SidebarMenu className="gap-3 lg:gap-3.5">
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

      <SidebarFooter className={cn('border-t border-sidebar-border/70 lg:border-t-0', collapsed ? 'px-3 py-3' : 'px-5 py-4 lg:px-0 lg:py-0')}>
        <div className={cn('flex rounded-xl lg:bg-accent-gradient-soft lg:p-2', collapsed ? 'flex-col items-center gap-2.5' : 'items-center gap-3')}>
          <button
            aria-label={t('profile.edit')}
            className="flex size-12 shrink-0 items-center justify-center rounded-md bg-accent-gradient-soft text-foreground shadow-sm transition-opacity hover:opacity-95 lg:bg-transparent lg:shadow-none"
            onClick={() => setProfileOpen(true)}
            title={profileIcon.label}
            type="button"
          >
            <ProfileIcon className="size-9" icon={admin.icon} />
          </button>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium leading-5 text-foreground">{admin.username}</div>
            </div>
          ) : null}
          <div className={cn('flex shrink-0 rounded-lg bg-background/20 p-0.5', collapsed ? 'flex-col' : 'ml-auto')}>
            <ThemeToggle className="size-9 shrink-0 text-muted-foreground hover:bg-muted/30 [&_svg]:size-[18px]" compact />
            <LanguageSwitcher className="size-9 shrink-0 text-muted-foreground hover:bg-muted/30 [&_svg]:size-[18px]" compact />
          </div>
          <Button
            aria-label={t('nav.signOut')}
            className="size-10 shrink-0 text-muted-foreground [&_svg]:size-5"
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

      <ProfileDialog
        admin={admin}
        onOpenChange={setProfileOpen}
        open={profileOpen}
        updateAdmin={updateAdmin}
      />
    </div>
  );
}

function ProfileDialog({
  admin,
  onOpenChange,
  open,
  updateAdmin,
}: {
  admin: Admin;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  updateAdmin: (input: { icon: AdminIcon; password?: string; username: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [icon, setIcon] = useState<AdminIcon>(profileIconMeta(admin.icon).id);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState(admin.username);

  useEffect(() => {
    if (!open) return;
    setIcon(profileIconMeta(admin.icon).id);
    setPassword('');
    setUsername(admin.username);
  }, [admin.icon, admin.username, open]);

  async function saveProfile() {
    setSaving(true);
    try {
      await updateAdmin({
        icon,
        password: password ? password : undefined,
        username: username.trim(),
      });
      toast.success(t('profile.updated'));
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('profile.updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('profile.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="profile-username">{t('login.username')}</Label>
            <Input
              id="profile-username"
              onChange={(event) => setUsername(event.target.value)}
              value={username}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-password">{t('login.password')}</Label>
            <Input
              id="profile-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('profile.passwordPlaceholder')}
              type="password"
              value={password}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('profile.icon')}</Label>
            <div className="grid grid-cols-5 gap-2">
              {profileIconOptions.map((option) => {
                const selected = icon === option.id;

                return (
                  <button
                    aria-label={option.label}
                    className={cn(
                      'relative flex aspect-square items-center justify-center rounded-md bg-muted/45 p-2 transition-colors hover:bg-muted/70',
                      selected && 'bg-accent-gradient-soft ring-2 ring-ring/45',
                    )}
                    key={option.id}
                    onClick={() => setIcon(option.id)}
                    type="button"
                  >
                    <ProfileIcon className="size-10" icon={option.id} />
                    {selected ? (
                      <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent-gradient text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="secondary">
            {t('common.cancel')}
          </Button>
          <Button disabled={saving} onClick={() => void saveProfile()} type="button">
            <Save />
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileIcon({ className, icon }: { className?: string; icon?: AdminIcon }) {
  const meta = profileIconMeta(icon);
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn('block object-contain', className)}
      draggable={false}
      src={meta.src}
    />
  );
}

function AppBrand({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center', iconOnly && 'justify-center')}>
      <BrandLogo className={cn(iconOnly ? 'h-10 w-10' : compact ? 'h-10 w-20' : 'h-14 w-32')} />
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
      <SidebarMenuButton
        asChild
        className="h-14 gap-3 rounded-xl px-4 text-[15px] before:hidden"
        isActive={isActive}
        tooltip={label}
      >
        <Link
          aria-current={isActive ? 'page' : undefined}
          onClick={onClick}
          to={to}
        >
          <span
            data-slot="sidebar-menu-icon"
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-current transition-colors group-data-[active=true]/menu-button:text-primary-foreground"
          >
            <Icon aria-hidden="true" className="size-[22px]" />
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
