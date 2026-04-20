import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/features/auth/useAuth';
import { BrandMark, Button, Card, CardContent, Input, Label } from '@/shared/ui/primitives';

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
    if (admin) {
      navigate({ to: '/' });
    }
  }, [admin, navigate]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-4 py-10 text-foreground">
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_72%)]" />
      <div className="relative flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-[420px]">
          <CardContent className="p-8">
            <BrandMark subtitle="Secure admin access" />

            <div className="mt-8 space-y-2">
              <h1 className="t-h1">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to continue. Session access stays short-lived and refreshes through a secure cookie.</p>
            </div>

            <form
              className="mt-8 space-y-5"
              onSubmit={form.handleSubmit(async (values) => {
                await login(values);
                navigate({ to: '/' });
              })}
            >
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" {...form.register('username')} />
                {form.formState.errors.username ? <div className="text-xs text-destructive">{form.formState.errors.username.message}</div> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} {...form.register('password')} className="pr-11" />
                  <button
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition hover:text-foreground"
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {form.formState.errors.password ? <div className="text-xs text-destructive">{form.formState.errors.password.message}</div> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="totp">2FA code</Label>
                <Input id="totp" inputMode="numeric" placeholder="Optional" {...form.register('totp')} />
              </div>

              <Button busy={form.formState.isSubmitting} className="w-full" trailingIcon={<ArrowRight className="size-4" />} type="submit">
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
