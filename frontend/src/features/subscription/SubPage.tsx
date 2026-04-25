import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronRight, Copy, Link2, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import { UserLinks } from '@/shared/api/types';
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
    steps: [
      'Install Streisand, Karing, or Shadowrocket from the App Store.',
      'Open the app and choose "Import from clipboard" or scan a QR code.',
      'Paste the subscription URL or scan the QR above.',
    ],
  },
  {
    title: 'Android',
    steps: [
      'Install v2rayNG, Hiddify, or Karing from a trusted release.',
      'Choose "Import from clipboard" or scan the QR.',
      'Refresh the subscription if your link is ever rotated.',
    ],
  },
  {
    title: 'Desktop',
    steps: [
      'Install Hiddify on your desktop.',
      'Import via subscription URL or scan the QR with the client camera.',
      'Keep the subscription entry enabled for automatic updates.',
    ],
  },
] as const;

export function SubPage() {
  const { token } = useParams({ from: '/u/$token' });
  const navigate = useNavigate({ from: '/u/$token' });
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => getPreferredTheme());
  const os = typeof window !== 'undefined' ? detectOS() : 'desktop';

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => setTheme(media.matches ? 'light' : 'dark');
    handler();
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const subscription = useQuery({
    queryKey: ['public-sub', token],
    queryFn: () => apiClient.request<UserLinks>(`/sub/${token}?format=json`),
  });

  const rotateLink = useMutation({
    mutationFn: () => apiClient.request<UserLinks>(`/sub/${token}/rotate`, { method: 'POST' }),
    onSuccess: async (next) => {
      toast.success('Subscription link rotated');
      const nextToken = subscriptionTokenFromURL(next.subscription);
      if (nextToken && nextToken !== token) {
        queryClient.setQueryData(['public-sub', nextToken], next);
        await navigate({ to: '/u/$token', params: { token: nextToken }, replace: true });
        return;
      }
      queryClient.setQueryData(['public-sub', token], next);
      await queryClient.invalidateQueries({ queryKey: ['public-sub', token] });
    },
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
  const usageFillClass = percent >= 90 ? 'bg-destructive' : percent >= 70 ? 'bg-warning' : 'bg-primary';
  const expiringSoon = expiryDays !== null && expiryDays >= 0 && expiryDays < 3;
  const expired = expiryDays !== null && expiryDays < 0;

  if (subscription.isError) {
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground" data-theme={theme}>
        <div className="mx-auto flex min-h-screen max-w-[480px] items-center justify-center">
          <Card className="w-full">
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <div className="space-y-1">
                <div className="text-base font-semibold text-foreground">
                  This link is no longer valid
                </div>
                <p className="max-w-md text-sm text-muted-foreground">
                  This subscription link was rotated or is no longer available.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground" data-theme={theme}>
      <div className="relative min-h-screen">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-40" />
        <div className="relative mx-auto w-full max-w-[480px] space-y-6 px-4 py-10 sm:py-14">
          <header className="space-y-5 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
              <ShieldCheck className="size-6" />
            </div>
            <div className="space-y-1">
              <div className="t-hero">MyVPN</div>
              <p className="text-sm text-muted-foreground">Your secure connection</p>
            </div>
          </header>

          <Card>
            <CardContent className="flex flex-col items-center gap-5 p-6">
              {subscription.isLoading ? (
                <Skeleton className="aspect-square w-full max-w-[260px] rounded-md" />
              ) : (
                <QRCodePreview
                  label="Subscription QR"
                  maxWidthClassName="max-w-[280px]"
                  value={subscriptionURL}
                />
              )}
              <Button
                className="w-full"
                onClick={async () => {
                  if (!subscriptionURL) return;
                  await navigator.clipboard.writeText(subscriptionURL);
                  toast.success('Subscription link copied');
                }}
                size="lg"
                type="button"
              >
                <Link2 className="size-4" />
                Copy subscription link
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
                          : 'Unlimited'}
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="t-label">Used</div>
                      <div className="text-xl font-semibold text-foreground">
                        {unlimited ? 'Unlimited' : `${Math.round(percent)}%`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {unlimited
                          ? 'No hard traffic cap'
                          : `${formatBytes(usage?.traffic_used ?? 0)} of ${formatBytes(usage?.traffic_limit ?? 0)}`}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="t-label">Expires</div>
                      <div
                        className={cn(
                          'text-xl font-semibold text-foreground',
                          expired && 'text-destructive',
                          expiringSoon && 'text-warning',
                        )}
                      >
                        {relativeExpiry(usage?.expires_at ?? null)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {usage?.expires_at ? formatDate(usage.expires_at) : 'No expiry date'}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="t-label px-2 pb-1">Connect with one tap</div>
              {clientLinks[os].map((client) => (
                <a
                  className="group flex min-h-12 items-center gap-3 rounded-md border border-border bg-surface-elevated px-3 py-3 transition hover:border-primary/30 hover:bg-[hsl(var(--primary)/0.06)]"
                  href={client.href}
                  key={client.label}
                  rel="noreferrer"
                  target="_blank"
                >
                  <img alt="" className="size-9 rounded-md" src={client.icon} />
                  <span className="flex-1 text-sm font-medium text-foreground">{client.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </a>
              ))}
            </CardContent>
          </Card>

          <details className="group rounded-lg border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-foreground">
              <span>How to connect</span>
              <ChevronRight className="size-4 text-muted-foreground transition group-open:rotate-90" />
            </summary>
            <div className="space-y-3 border-t border-border px-5 py-5">
              {helpSections.map((section) => (
                <div
                  className="rounded-md border border-border bg-surface-elevated p-4"
                  key={section.title}
                >
                  <div className="mb-3 t-label">{section.title}</div>
                  <ol className="space-y-2 text-sm text-muted-foreground">
                    {section.steps.map((step, index) => (
                      <li className="flex gap-3" key={step}>
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-[10px] text-muted-foreground">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </details>

          <details className="group rounded-lg border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-foreground">
              <span>Advanced - individual keys</span>
              <ChevronRight className="size-4 text-muted-foreground transition group-open:rotate-90" />
            </summary>
            <div className="space-y-4 border-t border-border px-5 py-5">
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
                        className="space-y-3 rounded-md border border-border bg-surface-elevated p-4"
                        key={item.label}
                      >
                        <div className="t-label">{item.label}</div>
                        <QRCodePreview label={item.label} value={item.value} />
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-foreground">
                          {item.value}
                        </div>
                        <Button
                          className="w-full"
                          onClick={async () => {
                            if (!item.value) return;
                            await navigator.clipboard.writeText(item.value);
                            toast.success(`${item.label} copied`);
                          }}
                          type="button"
                          variant="secondary"
                        >
                          <Copy className="size-4" />
                          Copy
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>

          <div className="flex justify-center pt-2">
            <Button
              disabled={rotateLink.isPending}
              onClick={() => rotateLink.mutate()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <RotateCcw className={cn('size-4', rotateLink.isPending && 'animate-spin')} />
              {rotateLink.isPending ? 'Resetting...' : 'Reset my link'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getPreferredTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function subscriptionURLForCurrentOrigin(token: string, fallback: string): string {
  if (!fallback) {
    return '';
  }
  const base =
    typeof window === 'undefined'
      ? fallback
      : `${window.location.origin}/sub/${encodeURIComponent(token)}`;
  try {
    return new URL(base).toString();
  } catch {
    return base;
  }
}

function subscriptionTokenFromURL(value: string): string {
  if (!value) {
    return '';
  }
  try {
    const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const url = new URL(value, base);
    const parts = url.pathname.split('/').filter(Boolean);
    const subIndex = parts.lastIndexOf('sub');
    if (subIndex >= 0 && parts[subIndex + 1]) {
      return parts[subIndex + 1];
    }
  } catch {
    // Fall back to a lightweight path match below.
  }
  return value.match(/\/sub\/([^/?#]+)/)?.[1] ?? '';
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
          'flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border bg-white p-3',
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
        'aspect-square w-full rounded-md border border-border bg-surface',
        maxWidthClassName,
      )}
    />
  );
}
