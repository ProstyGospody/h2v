import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/useAuth';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

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
    <div className="flex min-h-screen items-center justify-center bg-app-background px-4 py-10 text-foreground">
      <Card className="w-full max-w-100 border-border/60 bg-card shadow-overlay">
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

            <Button className="h-11 w-full" disabled={form.formState.isSubmitting} size="lg" type="submit">
              {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
