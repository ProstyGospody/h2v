import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/features/auth/useAuth';
import { Button, Card, CardContent, Input, Label } from '@/shared/ui/primitives';

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
    <div className="relative isolate min-h-screen overflow-hidden bg-background px-4 py-10 text-foreground">
      <div aria-hidden className="absolute inset-0 bg-grid opacity-50" />
      <div
        aria-hidden
        className="absolute inset-x-0 top-[-10%] h-[55%] bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.14),transparent_70%)]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md border border-primary/30 bg-primary/12 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <span className="font-serif text-3xl italic leading-none tracking-[-0.02em]">MyPanel</span>
        </div>

        <Card className="w-full">
          <CardContent className="space-y-6 p-8">
            <div className="space-y-1.5">
              <h1 className="t-h1 text-foreground">Welcome back</h1>
              <p className="text-sm text-muted-foreground">Sign in to continue.</p>
            </div>

            <form
              className="space-y-4"
              onSubmit={form.handleSubmit(async (values) => {
                await login(values);
                navigate({ to: '/' });
              })}
            >
              <Field error={form.formState.errors.username?.message} htmlFor="username" label="Username">
                <Input autoComplete="username" id="username" {...form.register('username')} />
              </Field>

              <Field error={form.formState.errors.password?.message} htmlFor="password" label="Password">
                <div className="relative">
                  <Input autoComplete="current-password" id="password" type={showPassword ? 'text' : 'password'} {...form.register('password')} className="pr-10" />
                  <button
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition hover:text-foreground"
                    onClick={() => setShowPassword((current) => !current)}
                    type="button"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>

              <Field htmlFor="totp" label="2FA code" optional>
                <Input autoComplete="one-time-code" id="totp" inputMode="numeric" maxLength={6} placeholder="123456" {...form.register('totp')} />
              </Field>

              <Button busy={form.formState.isSubmitting} className="w-full" trailingIcon={<ArrowRight className="size-4" />} type="submit">
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-xs text-muted-foreground">Sessions are short-lived and refreshed over a secure cookie.</p>
      </div>
    </div>
  );
}

function Field({
  children,
  error,
  htmlFor,
  label,
  optional = false,
}: {
  children: React.ReactNode;
  error?: string;
  htmlFor: string;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional ? <span className="text-[10px] uppercase tracking-[0.08em] text-faint">Optional</span> : null}
      </div>
      {children}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
    </div>
  );
}
