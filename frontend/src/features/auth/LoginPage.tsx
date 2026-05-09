import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, LockKeyhole, LogIn, UserRound } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/useAuth';
import { useI18n } from '@/shared/i18n/i18n';

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { admin, login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    if (admin) navigate({ to: '/' });
  }, [admin, navigate]);

  return (
    <div className="login-screen relative min-h-screen overflow-hidden text-foreground">
      <div aria-hidden="true" className="login-screen-ambient" />

      <div className="login-language">
        <LanguageSwitcher className="login-language-button" />
      </div>

      <main className="login-auth-panel">
        <div aria-hidden="true" className="login-auth-grid" />
        <section aria-label={t('login.signIn')} className="login-auth-content">
          <BrandLogo className="login-brand" />

          <form
            className="login-form"
            onSubmit={form.handleSubmit(async (values) => {
              await login(values);
              navigate({ to: '/' });
            })}
          >
            <div className="login-field">
              <label className="login-field-label" htmlFor="username">
                {t('login.username')}
              </label>
              <div className="login-input-shell">
                <UserRound aria-hidden="true" className="login-input-icon" />
                <Input
                  aria-invalid={Boolean(form.formState.errors.username)}
                  aria-label={t('login.username')}
                  autoComplete="username"
                  className="login-input"
                  id="username"
                  placeholder={t('login.username')}
                  {...form.register('username')}
                />
              </div>
            </div>

            <div className="login-field">
              <label className="login-field-label" htmlFor="password">
                {t('login.password')}
              </label>
              <div className="login-input-shell">
                <LockKeyhole aria-hidden="true" className="login-input-icon" />
                <Input
                  aria-invalid={Boolean(form.formState.errors.password)}
                  aria-label={t('login.password')}
                  autoComplete="current-password"
                  className="login-input login-input-password"
                  id="password"
                  placeholder={t('login.password')}
                  type={showPassword ? 'text' : 'password'}
                  {...form.register('password')}
                />
                <button
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  className="login-password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  type="button"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button
              className="button-shine login-submit"
              disabled={form.formState.isSubmitting}
              size="lg"
              type="submit"
            >
              <LogIn aria-hidden="true" className="size-4" />
              {form.formState.isSubmitting ? t('login.signingIn') : t('login.signIn')}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
