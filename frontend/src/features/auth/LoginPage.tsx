import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/useAuth';
import { useI18n } from '@/shared/i18n/i18n';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

const panelCodeFragments = [
  '2026-05-03T00:42:11Z auth.login username=admin status=200 access_token=rotated refresh_cookie=set',
  'const admin = await repo.getAdminByUsername(ctx, input.username);',
  'if (!verifyPassword(admin.passwordHash, input.password)) throw unauthorized("invalid_credentials");',
  'apiClient.setUnauthorizedHandler(() => setAdmin(null));',
  'POST /api/auth/refresh -> 200 { access_token, admin: { username, role: "admin" } }',
  'GET /api/stats/overview -> { uptime_seconds, xray_status, hysteria_status, online_users }',
  'GET /api/settings -> [{ key: "vless.port", value: 8444, updated_at }]',
  'PATCH /api/settings -> 200 { updated: true }',
  'POST /api/settings/reality-keypair -> { private_key, public_key }',
  'GET /api/configs/xray -> { content: ".../configs/xray/config.json" }',
  'POST /api/configs/hysteria/apply -> 200 { applied: true }',
  'panel config render --core xray -> /opt/mypanel/configs/xray/config.json',
  'panel geodata update -> /opt/mypanel/data/geodata/{geoip.dat,geosite.dat}',
  'systemctl restart xray.service hysteria.service h2v-telegram.service',
  'backup.export filename=h2v-backup.json type=h2v.panel.backup',
  'GET /sub/{token}?format=json -> { subscription, vless, hysteria2, usage }',
  'subscription.link user=client-014 protocols=[vless,hysteria2] portal=/u/{token}',
  'traffic.collect core=xray users_matched=128 reset_stats=true',
  'rate_limit bucket=login key=127.0.0.1 remaining=4 reset=60s',
  'repository.upsertUser username=client-014 traffic_limit=107374182400 status=active',
  'logger.info("core stats collected", "xray", xStats.length, "hysteria", hStats.length);',
  'PATCH /api/users/7f8c... -> rotate subscription token, preserve traffic counters',
  'settings.validate hy2.obfs_enabled=true hy2.obfs_password=present result=ok',
  'telegram.reconcile config=/opt/mypanel/configs/telegram/telemt.toml service=h2v-telegram',
  'hy2.auth local-only password=*** -> { ok: true, id: username }',
  'scheduler.every collector=10s enforcer=30s traffic_retention=24h',
  'health.check panel=ok postgres=ok xray=ok hysteria=ok geodata=fresh',
  '/opt/mypanel/install.sh reset-admin admin ********',
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app-background px-4 py-10 text-foreground">
      <CodeRainBackground />
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <ThemeToggle compact />
        <LanguageSwitcher />
      </div>

      <Card aria-label={t('login.signIn')} className="login-modal login-modal-access relative z-10 w-full max-w-[920px]">
        <div className="login-modal-brand" aria-hidden="true">
          <BrandLogo alt="" className="h-20 w-40" />
          <div className="login-modal-brand-grid">
            <span />
            <span />
            <span />
          </div>
        </div>

        <CardContent className="login-modal-form px-6 py-8 sm:px-10 sm:py-11">
          <div className="flex justify-center md:hidden">
            <BrandLogo className="h-16 w-32" />
          </div>

          <form
            className="flex w-full flex-col gap-5"
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              await login(values);
              navigate({ to: '/' });
            })}
          >
            <FieldGroup className="gap-5">
              <Field className="gap-2.5" data-invalid={usernameInvalid || undefined}>
                <FieldLabel htmlFor="username">{t('login.username')}</FieldLabel>
                <Input
                  aria-invalid={usernameInvalid}
                  autoComplete="username"
                  className="h-12 px-4 text-sm"
                  id="username"
                  placeholder={t('login.username')}
                  {...form.register('username')}
                />
              </Field>

              <Field className="gap-2.5" data-invalid={passwordInvalid || undefined}>
                <FieldLabel htmlFor="password">{t('login.password')}</FieldLabel>
                <div className="relative">
                  <Input
                    aria-invalid={passwordInvalid}
                    autoComplete="current-password"
                    className="h-12 px-4 pr-12 text-sm"
                    id="password"
                    placeholder={t('login.password')}
                    type={showPassword ? 'text' : 'password'}
                    {...form.register('password')}
                  />
                  <Button
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                    className="absolute right-2 top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
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

            <Button className="h-12 w-full" disabled={form.formState.isSubmitting} type="submit">
              {form.formState.isSubmitting ? t('login.signingIn') : t('login.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function CodeRainBackground() {
  const codeCanvas = useMemo(() => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      panelCodeFragments
        .map((line, lineIndex) => {
          const marker = `${String(index + 1).padStart(2, '0')}:${String(lineIndex + 1).padStart(2, '0')}`;
          const trail = [7, 13, 19, 24].map((offset) => panelCodeFragments[(lineIndex + offset) % panelCodeFragments.length]);

          return `${marker}  ${[line, ...trail].join('      ')}`;
        })
        .join('\n'),
    );

    return rows.join('\n');
  }, []);

  return (
    <div aria-hidden="true" className="login-code-background">
      <div className="login-code-sheet">
        <pre>{codeCanvas}</pre>
        <pre>{codeCanvas}</pre>
      </div>
    </div>
  );
}
