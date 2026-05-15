import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, Github, MapPin } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { CoreLogo } from '@/components/core-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/useAuth';
import { apiClient } from '@/shared/api/client';
import type { ServerInfo, ServerProtocol } from '@/shared/api/types';
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

const fallbackLoginProtocols: ServerProtocol[] = [
  { enabled: true, id: 'vless', label: 'VLESS', logo: 'xray', port: 0, transport: 'TCP' },
  { enabled: true, id: 'hysteria2', label: 'Hysteria 2', logo: 'hysteria', port: 0, transport: 'UDP' },
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
  const serverInfo = useQuery({
    queryKey: ['public', 'server-info'],
    queryFn: () => apiClient.request<ServerInfo>('/public/server-info'),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const protocols = serverInfo.data?.protocols?.length ? serverInfo.data.protocols : fallbackLoginProtocols;

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

      <Card aria-label={t('login.signIn')} className="login-modal login-modal-access relative z-10 w-full max-w-[480px]">
        <CardContent className="login-modal-form px-6 py-7 sm:px-9 sm:py-9">
          <form
            className="flex w-full flex-col gap-4"
            noValidate
            onSubmit={form.handleSubmit(async (values) => {
              await login(values);
              navigate({ to: '/' });
            })}
          >
            <div className="login-modal-inline-brand">
              <BrandLogo className="h-16 w-32" />
              <div className="login-modal-brand-meta">
                <LoginServerLocation info={serverInfo.data} loading={serverInfo.isLoading} />
                <LoginProtocolStack protocols={protocols} />
              </div>
            </div>

            <FieldGroup className="gap-4">
              <Field className="gap-2" data-invalid={usernameInvalid || undefined}>
                <FieldLabel htmlFor="username">{t('login.username')}</FieldLabel>
                <Input
                  aria-invalid={usernameInvalid}
                  autoComplete="username"
                  id="username"
                  placeholder={t('login.username')}
                  {...form.register('username')}
                />
              </Field>

              <Field className="gap-2" data-invalid={passwordInvalid || undefined}>
                <FieldLabel htmlFor="password">{t('login.password')}</FieldLabel>
                <div className="relative">
                  <Input
                    aria-invalid={passwordInvalid}
                    autoComplete="current-password"
                    className="pr-11"
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

            <Button className="w-full" disabled={form.formState.isSubmitting} type="submit">
              {form.formState.isSubmitting ? t('login.signingIn') : t('login.signIn')}
            </Button>

            <a
              aria-label="GitHub"
              className="login-modal-github"
              href="https://github.com/ProstyGospody/h2v"
              rel="noreferrer"
              target="_blank"
            >
              <Github className="size-4" />
              <span>GitHub</span>
            </a>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function LoginServerLocation({ info, loading }: { info?: ServerInfo; loading: boolean }) {
  const { t } = useI18n();
  const location = [info?.city, info?.country].filter(Boolean).join(', ');

  return (
    <div className="login-modal-location">
      <div className="login-modal-location-mark">
        {info?.country_code ? (
          <img
            alt=""
            aria-hidden="true"
            className="login-modal-location-flag"
            draggable={false}
            src={countryFlagURL(info.country_code)}
          />
        ) : (
          <MapPin className="size-4" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold leading-5 text-foreground">
          {loading ? t('login.detectingLocation') : location || t('login.locationUnavailable')}
        </div>
      </div>
    </div>
  );
}

function LoginProtocolStack({ protocols }: { protocols: ServerProtocol[] }) {
  const visibleProtocols = protocols.filter((protocol) => protocol.enabled).slice(0, 3);

  return (
    <div className="login-modal-protocols">
      {visibleProtocols.map((protocol) => (
        <div className="login-modal-protocol" key={protocol.id}>
          <span className="login-modal-protocol-logo">
            <CoreLogo className={protocol.logo === 'hysteria' ? 'h-6 w-8' : 'size-6'} core={protocol.logo} />
          </span>
          <span className="login-modal-protocol-label">{protocol.label}</span>
        </div>
      ))}
    </div>
  );
}

function countryFlagURL(countryCode: string): string {
  return `https://flagcdn.com/24x18/${countryCode.trim().toLowerCase()}.png`;
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
