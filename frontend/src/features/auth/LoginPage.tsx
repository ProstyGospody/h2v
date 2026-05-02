import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/useAuth';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

const repositoryUrl = 'https://github.com/ProstyGospody/h2v';

const panelCodeFragments = [
  '2026-05-03T00:42:11Z auth.login username=admin status=200 access_token=rotated refresh_cookie=set',
  'const admin = await repo.getAdminByUsername(ctx, input.username);',
  'if (!verifyPassword(admin.passwordHash, input.password)) throw unauthorized("invalid_credentials");',
  'apiClient.setUnauthorizedHandler(() => authStore.clear());',
  'POST /api/auth/refresh -> 200 { access_token, admin: { role: "owner" } }',
  'const runtime = await settings.loadRuntime(["xray", "hy2", "subscription"]);',
  'renderConfig("xray.config.json.tmpl", { host, port, users, reality, routing });',
  'renderConfig("hysteria.config.json.tmpl", { listen, obfs, bandwidth, tls, authWebhook });',
  'subscription.sync user=client-014 vless=ready hysteria2=ready sing-box=ready',
  'cache.users.rebuild count=128 indexes=[id, sub_token, hy2_password]',
  'metrics.push({ name: "panel_users_total", value: activeUsers.length, labels: { status: "active" } });',
  'traffic.delta username=demo rx=21.8MiB tx=4.6MiB core=xray inbound=vless',
  'await services.configs.apply(ctx, draft, { reload: true, backup: "before-change" });',
  'systemctl reload xray.service && systemctl reload hysteria.service && systemctl reload panel.service',
  'backup.snapshot created path=/var/lib/h2v/backups/2026-05-03T00-42-11Z.json encrypted=false',
  'GET /api/dashboard -> { cpu, memory, uptime, cores: ["xray", "hysteria2"], online: 73 }',
  'const node = buildShareLink({ protocol: "hysteria2", sni, insecure: false, obfs: "salamander" });',
  'rate_limit bucket=login key=127.0.0.1 remaining=4 reset=60s',
  'repository.upsertUser username=client-014 traffic_limit=107374182400 status=active',
  'logger.info("core stats collected", "xray", xStats.length, "hysteria", hStats.length);',
  'PATCH /api/users/7f8c... -> rotate subscription token, preserve traffic counters',
  'const qrcode = createSubscriptionQr(`/sub/${user.subToken}`, { theme: "h2v" });',
  'settings.validate hy2.obfs_enabled=true hy2.obfs_password=present result=ok',
  'GET /api/configs/rendered?core=xray -> 200 content-type=application/json',
  'db.migrate version=004_remove_subscription_credential_setting dirty=false elapsed=38ms',
  'tls.certificate renew domain=edge.example.net issuer=letsencrypt expires_in=62d',
  'stream.send("traffic:update", { online, rxRate, txRate, totalUsed });',
  'const next = reconcileRuntime(previous, draft, { preserveSecrets: true });',
  'health.check panel=ok postgres=ok xray=ok hysteria=ok geodata=fresh',
  'ssh panel@edge "h2v admin set-password --username admin --password ********"',
];

export function LoginPage() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: 'admin', password: '' },
  });

  useEffect(() => {
    if (admin) navigate({ to: '/' });
  }, [admin, navigate]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app-background px-4 py-10 text-foreground">
      <CodeRainBackground />

      <Card className="relative z-10 w-full max-w-100 border-border/60 bg-card/90 shadow-overlay backdrop-blur-xl">
        <CardContent className="space-y-9 px-7 py-10 sm:px-9 sm:py-12">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="block font-display text-5xl font-bold italic leading-none text-accent-gradient">
              h2v
            </span>
          </div>

          <form
            className="grid gap-4"
            onSubmit={form.handleSubmit(async (values) => {
              await login(values);
              navigate({ to: '/' });
            })}
          >
            <Input
              aria-label="Username"
              autoComplete="username"
              className="h-11 px-4"
              id="username"
              placeholder="Username"
              {...form.register('username')}
            />

            <div className="relative">
              <Input
                aria-label="Password"
                autoComplete="current-password"
                className="h-11 px-4 pr-11"
                id="password"
                placeholder="Password"
                type={showPassword ? 'text' : 'password'}
                {...form.register('password')}
              />
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition hover:text-foreground"
                onClick={() => setShowPassword((value) => !value)}
                type="button"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>

            <Button className="button-shine h-11 w-full" disabled={form.formState.isSubmitting} size="lg" type="submit">
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="flex justify-center">
            <a
              aria-label="Open h2v on GitHub"
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45"
              href={repositoryUrl}
              rel="noreferrer"
              target="_blank"
            >
              <Github className="size-4" />
              <span>GitHub</span>
            </a>
          </div>
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
