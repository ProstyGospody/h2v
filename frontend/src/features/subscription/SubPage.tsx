import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ChevronRight, Link2, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import { UserLinks } from '@/shared/api/types';
import { detectOS } from '@/shared/lib/detectOS';
import { daysUntil, formatBytes, formatDate, relativeExpiry, usagePercent } from '@/shared/lib/format';
import { CopyButton, EmptyState, TrafficBar } from '@/shared/ui/primitives';

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
    { href: 'https://sing-box.sagernet.org/', icon: '/clients/singbox.svg', label: 'sing-box' },
  ],
} as const;

export function SubPage() {
  const { token } = useParams({ from: '/u/$token' });
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
    onSuccess: async () => {
      toast.success('Subscription link rotated');
      await queryClient.invalidateQueries({ queryKey: ['public-sub', token] });
    },
  });

  const data = subscription.data;
  const usage = data?.usage;
  const expiryDays = daysUntil(usage?.expires_at ?? null);
  const unlimited = (usage?.traffic_limit ?? 0) <= 0;
  const percent = unlimited ? 0 : usagePercent(usage?.traffic_used ?? 0, usage?.traffic_limit ?? 0);
  const expiringSoon = expiryDays !== null && expiryDays >= 0 && expiryDays < 3;
  const expired = expiryDays !== null && expiryDays < 0;

  if (subscription.isError) {
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground" data-theme={theme}>
        <div className="mx-auto flex min-h-screen max-w-[480px] items-center justify-center">
          <EmptyState
            description="This subscription link was rotated or is no longer available."
            title="This link is no longer valid"
          />
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
                <img
                  alt="Subscription QR"
                  className="w-full max-w-[260px] rounded-md border border-border bg-white p-4"
                  src={data?.qr.subscription}
                />
              )}
              <Button
                className="w-full"
                onClick={async () => {
                  if (!data?.subscription) return;
                  await navigator.clipboard.writeText(data.subscription);
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
                  <TrafficBar
                    animated
                    total={usage?.traffic_limit ?? 0}
                    used={usage?.traffic_used ?? 0}
                  />
                  <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
                    <Stat
                      label="Used"
                      primary={unlimited ? 'Unlimited' : `${Math.round(percent)}%`}
                      secondary={
                        unlimited
                          ? 'No hard traffic cap'
                          : `${formatBytes(usage?.traffic_used ?? 0)} of ${formatBytes(usage?.traffic_limit ?? 0)}`
                      }
                    />
                    <Stat
                      label="Expires"
                      primary={relativeExpiry(usage?.expires_at ?? null)}
                      primaryClass={cn(
                        expired && 'text-destructive',
                        expiringSoon && 'text-warning',
                      )}
                      secondary={usage?.expires_at ? formatDate(usage.expires_at) : 'No expiry date'}
                    />
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
              <HelpSection
                steps={[
                  'Install Streisand, Karing, or Shadowrocket from the App Store.',
                  'Open the app and choose "Import from clipboard" or scan a QR code.',
                  'Paste the subscription URL or scan the QR above.',
                ]}
                title="iOS"
              />
              <HelpSection
                steps={[
                  'Install v2rayNG, Hiddify, or Karing from a trusted release.',
                  'Choose "Import from clipboard" or scan the QR.',
                  'Refresh the subscription if your link is ever rotated.',
                ]}
                title="Android"
              />
              <HelpSection
                steps={[
                  'Install Hiddify or sing-box on your desktop.',
                  'Import via subscription URL or scan the QR with the client camera.',
                  'Keep the subscription entry enabled for automatic updates.',
                ]}
                title="Desktop"
              />
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
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                </>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <AdvancedCard
                    image={data?.qr.vless}
                    label="VLESS - Reality"
                    value={data?.vless ?? ''}
                  />
                  <AdvancedCard
                    image={data?.qr.hysteria2}
                    label="Hysteria 2"
                    value={data?.hysteria2 ?? ''}
                  />
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

function Stat({
  label,
  primary,
  primaryClass,
  secondary,
}: {
  label: string;
  primary: string;
  primaryClass?: string;
  secondary: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="t-label">{label}</div>
      <div className={cn('text-xl font-semibold text-foreground', primaryClass)}>{primary}</div>
      <div className="text-xs text-muted-foreground">{secondary}</div>
    </div>
  );
}

function AdvancedCard({ image, label, value }: { image?: string; label: string; value: string }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-elevated p-4">
      <div className="t-label">{label}</div>
      {image ? (
        <img alt={label} className="w-full rounded-sm bg-white p-3" src={image} />
      ) : (
        <div className="aspect-square rounded-sm border border-border bg-surface" />
      )}
      <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-foreground">
        {value}
      </div>
      <CopyButton className="w-full" value={value} />
    </div>
  );
}

function HelpSection({ steps, title }: { steps: string[]; title: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-4">
      <div className="t-label mb-3">{title}</div>
      <ol className="space-y-2 text-sm text-muted-foreground">
        {steps.map((step, index) => (
          <li className="flex gap-3" key={step}>
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-[10px] text-muted-foreground">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function getPreferredTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
