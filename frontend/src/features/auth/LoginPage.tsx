import { useEffect, useState, type ComponentType } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, FileCode2, LayoutDashboard, Settings2, ShieldCheck, Users } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/useAuth';
import { cn } from '@/lib/utils';
import { useI18n } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

const loginNavItems: Array<{
  icon: ComponentType<{ className?: string }>;
  labelKey: TranslationKey;
  active?: boolean;
}> = [
  { active: true, icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { icon: Users, labelKey: 'nav.users' },
  { icon: FileCode2, labelKey: 'nav.configs' },
  { icon: Settings2, labelKey: 'nav.settings' },
];

const loginServices: Array<{
  label: string;
  logo: CoreLogoName;
  tone: 'ok' | 'idle';
}> = [
  { label: 'Xray', logo: 'xray', tone: 'idle' },
  { label: 'Hysteria 2', logo: 'hysteria', tone: 'idle' },
];

export function LoginPage() {
  const { admin, login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: 'admin', password: '' },
  });

  useEffect(() => {
    if (admin) navigate({ to: '/' });
  }, [admin, navigate]);

  const usernameInvalid = Boolean(form.formState.errors.username);
  const passwordInvalid = Boolean(form.formState.errors.password);

  return (
    <div className="relative min-h-screen overflow-hidden bg-app-background text-foreground">
      <div aria-hidden="true" className="login-page-backdrop" />

      <main className="relative flex min-h-screen items-center justify-center px-4 py-6 sm:px-6 lg:px-8">
        <section className="login-shell grid w-full max-w-[860px] overflow-hidden rounded-lg border border-border/55 bg-card lg:grid-cols-[minmax(0,1fr)_380px]">
          <aside className="login-rail hidden min-h-[460px] border-r border-border/55 bg-sidebar-panel p-5 lg:flex lg:flex-col">
            <div className="flex h-14 items-center">
              <BrandLogo className="h-12 w-24" />
            </div>

            <div className="mt-5 flex flex-1 flex-col gap-7">
              <div>
                <div className="px-2 pb-2 t-label">{t('nav.workspace')}</div>
                <nav className="flex flex-col gap-1">
                  {loginNavItems.map((item) => {
                    const Icon = item.icon;

                    return (
                      <div
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground',
                          item.active && 'bg-accent-gradient-soft font-medium text-foreground',
                        )}
                        key={item.labelKey}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span>{t(item.labelKey)}</span>
                      </div>
                    );
                  })}
                </nav>
              </div>

              <div>
                <div className="px-2 pb-2 t-label">{t('nav.services')}</div>
                <div className="flex flex-col gap-1 px-1">
                  {loginServices.map((service) => (
                    <div
                      className="flex items-center gap-2.5 rounded-md px-1 py-1.5 text-sm text-foreground"
                      key={service.label}
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center">
                        <CoreLogo className="size-6" core={service.logo} />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold leading-5 text-white">
                        {service.label}
                      </span>
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full ring-2',
                          service.tone === 'ok'
                            ? 'bg-success ring-success/15'
                            : 'bg-muted-foreground ring-muted-foreground/10',
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-md border border-border/45 bg-background/35 p-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted-foreground" />
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  h2v panel
                </span>
              </div>
            </div>
          </aside>

          <Card aria-label={t('login.signIn')} className="login-card border-0 bg-transparent shadow-none">
            <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border/45 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <BrandLogo className="mb-5 h-12 w-24 lg:hidden" />
                <CardTitle className="text-base font-semibold leading-6">{t('login.signIn')}</CardTitle>
                <CardDescription className="font-mono text-xs uppercase tracking-wider">h2v panel</CardDescription>
              </div>
              <LanguageSwitcher className="shrink-0" compact />
            </CardHeader>

            <CardContent className="px-5 py-6 sm:px-6 sm:py-7">
              <form
                className="flex flex-col gap-5"
                noValidate
                onSubmit={form.handleSubmit(async (values) => {
                  await login(values);
                  navigate({ to: '/' });
                })}
              >
                <FieldGroup className="gap-4">
                  <Field data-invalid={usernameInvalid || undefined}>
                    <FieldLabel htmlFor="username">{t('login.username')}</FieldLabel>
                    <Input
                      aria-invalid={usernameInvalid}
                      autoComplete="username"
                      className="login-input h-10 px-3.5"
                      id="username"
                      placeholder={t('login.username')}
                      {...form.register('username')}
                    />
                  </Field>

                  <Field data-invalid={passwordInvalid || undefined}>
                    <FieldLabel htmlFor="password">{t('login.password')}</FieldLabel>
                    <div className="relative">
                      <Input
                        aria-invalid={passwordInvalid}
                        autoComplete="current-password"
                        className="login-input h-10 px-3.5 pr-11"
                        id="password"
                        placeholder={t('login.password')}
                        type={showPassword ? 'text' : 'password'}
                        {...form.register('password')}
                      />
                      <Button
                        aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                        className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                        onClick={() => setShowPassword((value) => !value)}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        {showPassword ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
                      </Button>
                    </div>
                  </Field>
                </FieldGroup>

                <Button className="h-10 w-full" disabled={form.formState.isSubmitting} type="submit">
                  {form.formState.isSubmitting ? t('login.signingIn') : t('login.signIn')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
