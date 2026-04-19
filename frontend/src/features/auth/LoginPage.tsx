import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Button, Card, Input } from '@/shared/ui/primitives';
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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <Card className="w-full max-w-md">
        <div className="mb-6">
          <div className="text-sm uppercase tracking-[0.12em] text-cyan-300">VPN Panel</div>
          <h1 className="mt-3 text-2xl font-semibold">Admin login</h1>
          <p className="mt-2 text-sm text-slate-400">Short-lived access, refresh cookie, and optional 2FA.</p>
        </div>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (values) => {
            await login(values);
            navigate({ to: '/' });
          })}
        >
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">Username</span>
            <Input {...form.register('username')} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">Password</span>
            <Input type="password" {...form.register('password')} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-slate-300">2FA code</span>
            <Input inputMode="numeric" {...form.register('totp')} />
          </label>
          <Button className="w-full" type="submit">
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  );
}
