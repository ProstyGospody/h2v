import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronRight, Copy, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import { UserLinks } from '@/shared/api/types';
import { useI18n } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';
import { detectOS } from '@/shared/lib/detectOS';
import { daysUntil, formatBytes, formatDate, relativeExpiry, usagePercent } from '@/shared/lib/format';

const clientLinks = {
  ios: [
    {
      href: 'https://apps.apple.com/app/streisand/id6450534064',
      icon: '/clients/streisand.svg',
      label: 'Streisand',
    },
    {
      href: 'https://apps.apple.com/app/karing/id6472431552',
      icon: '/clients/karing.svg',
      label: 'Karing',
    },
    {
      href: 'https://apps.apple.com/app/shadowrocket/id932747118',
      icon: '/clients/shadowrocket.svg',
      label: 'Shadowrocket',
    },
  ],
  android: [
    {
      href: 'https://github.com/2dust/v2rayNG/releases',
      icon: '/clients/v2rayng.svg',
      label: 'v2rayNG',
    },
    {
      href: 'https://github.com/hiddify/hiddify-next/releases',
      icon: '/clients/hiddify.svg',
      label: 'Hiddify',
    },
    {
      href: 'https://github.com/KaringX/karing/releases',
      icon: '/clients/karing.svg',
      label: 'Karing',
    },
  ],
  desktop: [
    {
      href: 'https://github.com/hiddify/hiddify-next/releases',
      icon: '/clients/hiddify.svg',
      label: 'Hiddify',
    },
  ],
} as const;

const helpSections = [
  {
    title: 'iOS',
    steps: ['subscription.iosStep1', 'subscription.iosStep2', 'subscription.iosStep3'],
  },
  {
    title: 'Android',
    steps: ['subscription.androidStep1', 'subscription.androidStep2', 'subscription.androidStep3'],
  },
  {
    title: 'Desktop',
    steps: ['subscription.desktopStep1', 'subscription.desktopStep2', 'subscription.desktopStep3'],
  },
] satisfies Array<{ steps: TranslationKey[]; title: string }>;

export function SubPage() {
  const { locale, t } = useI18n();
  const { token } = useParams({ from: '/u/$token' });
  const os = typeof window !== 'undefined' ? detectOS() : 'desktop';

  const subscription = useQuery({
    queryKey: ['public-sub', token],
    queryFn: () => apiClient.request<UserLinks>(`/sub/${token}?format=json`),
  });

  const data = subscription.data;
  const subscriptionURL = useMemo(
    () => (data ? subscriptionURLForCurrentOrigin(token, data.subscription) : ''),
    [data, token],
  );
  const usage = data?.usage;
  const expiryDays = daysUntil(usage?.expires_at ?? null);
  const unlimited = (usage?.traffic_limit ?? 0) <= 0;
  const percent = unlimited ? 0 : usagePercent(usage?.traffic_used ?? 0, usage?.traffic_limit ?? 0);
  const usageFillClass = percent >= 90 ? 'bg-destructive' : percent >= 70 ? 'bg-warning' : 'bg-accent-gradient';
  const expiringSoon = expiryDays !== null && expiryDays >= 0 && expiryDays < 3;
  const expired = expiryDays !== null && expiryDays < 0;

  if (subscription.isError) {
    return (
      <div className="relative min-h-screen bg-app-background px-4 py-10 text-foreground">
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
          <ThemeToggle compact />
          <LanguageSwitcher />
        </div>
        <div className="mx-auto flex min-h-screen max-w-120 items-center justify-center">
          <Card className="w-full">
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <div className="space-y-1">
                <div className="text-base font-semibold text-foreground">
                  {t('subscription.invalidTitle')}
                </div>
                <p className="max-w-md text-sm text-muted-foreground">
                  {t('subscription.invalidDescription')}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-background text-foreground">
      <div className="relative min-h-screen">
        <div className="relative mx-auto w-full max-w-120 space-y-6 px-4 py-10 sm:py-14">
          <header className="space-y-5 text-center">
            <div className="flex items-center justify-between">
              <div className="w-9" />
              <BrandLogo className="h-16 w-32" />
              <div className="flex items-center gap-1">
                <ThemeToggle compact />
                <LanguageSwitcher compact />
              </div>
            </div>
          </header>

          <Card>
            <CardContent className="flex flex-col items-center gap-5 p-6">
              {subscription.isLoading ? (
                <Skeleton className="aspect-square w-full max-w-65 rounded-[22px]" />
              ) : (
                <QRCodePreview
                  label={t('subscription.qr')}
                  maxWidthClassName="max-w-70"
                  value={subscriptionURL}
                />
              )}
              <Button
                className="w-full"
                onClick={async () => {
                  if (!subscriptionURL) return;
                  await navigator.clipboard.writeText(subscriptionURL);
                  toast.success(t('subscription.linkCopied'));
                }}
                size="lg"
                type="button"
              >
                <Link2 className="size-4" />
                {t('subscription.copyLink')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-6 p-6">
              {subscription.isLoading ? (
                <>
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-2 w-full" />
                  <Skeleton className="h-5 w-40" />
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', usageFillClass)}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono">{formatBytes(usage?.traffic_used ?? 0)}</span>
                      <span className="font-mono">
                        {(usage?.traffic_limit ?? 0) > 0
                          ? formatBytes(usage?.traffic_limit ?? 0)
                          : t('common.unlimited')}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-5 pt-1 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="t-label">{t('subscription.used')}</div>
                      <div className="text-xl font-semibold text-foreground">
                        {unlimited ? t('common.unlimited') : `${Math.round(percent)}%`}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="t-label">{t('subscription.expires')}</div>
                      <div
                        className={cn(
                          'text-xl font-semibold text-foreground',
                          expired && 'text-destructive',
                          expiringSoon && 'text-warning',
                        )}
                      >
                        {relativeExpiry(usage?.expires_at ?? null, locale)}
                      </div>
                      {usage?.expires_at ? (
                        <div className="text-xs text-muted-foreground">
                          {formatDate(usage.expires_at, undefined, locale)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4">
              {clientLinks[os].map((client) => (
                <a
                  className="group flex min-h-12 items-center gap-3 rounded-[22px] bg-surface-elevated px-3 py-3 transition hover:bg-[image:var(--gradient-accent-soft)]"
                  href={client.href}
                  key={client.label}
                  rel="noreferrer"
                  target="_blank"
                >
                  <img alt="" className="size-9 rounded-[18px]" src={client.icon} />
                  <span className="flex-1 text-sm font-medium text-foreground">{client.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </a>
              ))}
            </CardContent>
          </Card>

          <details className="group rounded-[22px] bg-surface shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-foreground">
              <span>{t('subscription.howToConnect')}</span>
              <ChevronRight className="size-4 text-muted-foreground transition group-open:rotate-90" />
            </summary>
            <div className="space-y-3 bg-muted/20 px-5 py-5">
              {helpSections.map((section) => (
                <div
                  className="rounded-[22px] bg-surface-elevated p-4"
                  key={section.title}
                >
                  <div className="mb-3 t-label">{section.title}</div>
                  <ol className="space-y-2 text-sm text-muted-foreground">
                    {section.steps.map((step, index) => (
                      <li className="flex gap-3" key={step}>
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-[10px] text-muted-foreground">
                          {index + 1}
                        </span>
                        <span>{t(step)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </details>

          <details className="group rounded-[22px] bg-surface shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-foreground">
              <span>{t('subscription.advanced')}</span>
              <ChevronRight className="size-4 text-muted-foreground transition group-open:rotate-90" />
            </summary>
            <div className="space-y-4 bg-muted/20 px-5 py-5">
              {subscription.isLoading ? (
                <>
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                </>
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      { label: 'VLESS - Reality', value: data?.vless ?? '' },
                      { label: 'Hysteria 2', value: data?.hysteria2 ?? '' },
                    ].map((item) => (
                      <div
                        className="space-y-3 rounded-[22px] bg-surface-elevated p-4"
                        key={item.label}
                      >
                        <div className="t-label">{item.label}</div>
                        <QRCodePreview label={item.label} value={item.value} />
                        <Button
                          className="w-full"
                          disabled={!item.value}
                          onClick={async () => {
                            if (!item.value) return;
                            await navigator.clipboard.writeText(item.value);
                            toast.success(t('common.copied', { label: item.label }));
                          }}
                          type="button"
                          variant="secondary"
                        >
                          <Copy className="size-4" />
                          {t('common.copy')}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function subscriptionURLForCurrentOrigin(token: string, fallback: string): string {
  if (!fallback) {
    return '';
  }
  const base = typeof window === 'undefined' ? fallback : `${window.location.origin}/sub/${encodeURIComponent(token)}`;
  try {
    return new URL(base).toString();
  } catch {
    return base;
  }
}

function QRCodePreview({
  label,
  value,
  maxWidthClassName = '',
}: {
  label: string;
  value: string;
  maxWidthClassName?: string;
}) {
  if (value) {
    return (
      <div
        aria-label={label}
        className={cn(
          'flex aspect-square w-full items-center justify-center overflow-hidden rounded-[22px] border border-border/65 bg-white p-3',
          maxWidthClassName,
        )}
        role="img"
      >
        <QRCodeSVG
          className="block h-full w-full"
          bgColor="#ffffff"
          fgColor="#050505"
          marginSize={4}
          level="L"
          size={256}
          style={{ height: '100%', width: '100%' }}
          title={label}
          value={value}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'aspect-square w-full rounded-[22px] border border-border/65 bg-surface',
        maxWidthClassName,
      )}
    />
  );
}
