import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/features/auth/useAuth';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: 'admin', password: '', totp: '' },
  });

  useEffect(() => {
    if (admin) navigate({ to: '/' });
  }, [admin, navigate]);

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-background px-4 py-10 text-foreground">
      <div aria-hidden className="absolute inset-0 bg-grid opacity-40" />
      <div
        aria-hidden
        className="absolute inset-x-0 top-[-10%] h-[55%] bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_70%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[400px] flex-col items-center justify-center">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/12 text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <span className="font-serif text-2xl italic leading-none tracking-[-0.02em]">
            MyPanel
          </span>
        </div>

        <Card className="w-full">
          <CardContent className="space-y-6 p-8">
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to continue.</p>
            </div>

            <form
              className="space-y-4"
              onSubmit={form.handleSubmit(async (values) => {
                await login(values);
                navigate({ to: '/' });
              })}
            >
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input autoComplete="username" id="username" {...form.register('username')} />
              </div>

              <div className="space-y-2">
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
                    onClick={() => setShowPassword((v) => !v)}
                    type="button"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="totp">2FA code</Label>
                <Input
                  autoComplete="one-time-code"
                  id="totp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  {...form.register('totp')}
                />
              </div>

              <Button className="w-full" disabled={form.formState.isSubmitting} type="submit">
                Sign in
                <ArrowRight />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
