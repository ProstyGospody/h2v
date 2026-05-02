import { type CSSProperties, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/useAuth';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

const codeColumns = [
  [
    'const tunnel = createNode("hysteria2");',
    'await auth.rotate(token);',
    'if (latency < 80) route.fast();',
    'metrics.push({ rx, tx, users });',
    'session.refresh(accessToken);',
    'proxy.bind("0.0.0.0:443");',
    'cache.warm("subscriptions");',
    'return encrypt(payload);',
  ],
  [
    'type Peer = { id: string; flow: number };',
    'for await (const event of stream) {',
    '  dashboard.patch(event);',
    '}',
    'const config = render(runtime);',
    'rules.allow(["vless", "hy2"]);',
    'logger.info("core:ready");',
    'health.check().ok();',
  ],
  [
    'POST /api/auth/login 200',
    'GET /api/users?status=active',
    'PATCH /api/settings/runtime',
    'WS frame: traffic.delta',
    'TLS handshake: accepted',
    'subscription.sync: complete',
    'backup.snapshot: sealed',
    'node.ping: 42ms',
  ],
  [
    'interface RuntimeSettings {',
    '  sni: string;',
    '  bandwidth: Limit;',
    '  obfs: Secret;',
    '}',
    'const next = reconcile(prev, draft);',
    'await core.reload(next);',
  ],
  [
    'ssh panel@edge',
    'systemctl reload h2v',
    'journalctl -u panel -f',
    'openssl x509 -noout -dates',
    'curl -fsS /api/health',
    'sqlite: migrations applied',
    'token: verified',
    'rate_limit: clear',
  ],
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
        <CardContent className="space-y-7 p-7 sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="block font-display text-3xl font-bold italic leading-none text-accent-gradient">
              h2v
            </span>
          </div>

          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (values) => {
              await login(values);
              navigate({ to: '/' });
            })}
          >
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input autoComplete="username" id="username" {...form.register('username')} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  autoComplete="current-password"
                  className="pr-10"
                  id="password"
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
            </div>

            <Button className="button-shine w-full" disabled={form.formState.isSubmitting} size="lg" type="submit">
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function CodeRainBackground() {
  return (
    <div aria-hidden="true" className="login-code-background">
      {codeColumns.map((lines, index) => {
        const style = {
          '--code-left': `${index * 22 - 6}%`,
          '--code-duration': `${18 + index * 3}s`,
          '--code-delay': `${index * -4}s`,
          '--code-opacity': `${0.42 - (index % 2) * 0.1}`,
          '--code-tilt': `${index % 2 === 0 ? -5 : 5}deg`,
        } as CSSProperties;

        const text = lines.concat(lines.slice(0, 5)).join('\n');

        return (
          <div className="login-code-column" key={index} style={style}>
            <div className="login-code-track">
              <pre>{text}</pre>
              <pre>{text}</pre>
            </div>
          </div>
        );
      })}
    </div>
  );
}
