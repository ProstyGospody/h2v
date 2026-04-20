import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ChevronRight, Link2, RotateCcw, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/shared/api/client';
import { UserLinks } from '@/shared/api/types';
import { detectOS } from '@/shared/lib/detectOS';
import { daysUntil, formatDate, relativeExpiry } from '@/shared/lib/format';
import { Button, Card, CardContent, CopyButton, EmptyState, SecondaryButton, Skeleton, TrafficBar } from '@/shared/ui/primitives';

const clientLinks = {
  ios: [
    { href: 'https://apps.apple.com/app/streisand/id6450534064', icon: '/clients/streisand.svg', label: 'Streisand' },
    { href: 'https://apps.apple.com/app/karing/id6472431552', icon: '/clients/karing.svg', label: 'Karing' },
    { href: 'https://apps.apple.com/app/shadowrocket/id932747118', icon: '/clients/shadowrocket.svg', label: 'Shadowrocket' },
  ],
  android: [
    { href: 'https://github.com/2dust/v2rayNG/releases', icon: '/clients/v2rayng.svg', label: 'v2rayNG' },
    { href: 'https://github.com/hiddify/hiddify-next/releases', icon: '/clients/hiddify.svg', label: 'Hiddify' },
    { href: 'https://github.com/KaringX/karing/releases', icon: '/clients/karing.svg', label: 'Karing' },
  ],
  desktop: [
    { href: 'https://github.com/hiddify/hiddify-next/releases', icon: '/clients/hiddify.svg', label: 'Hiddify' },
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
  const expiryDays = daysUntil(data?.usage.expires_at ?? null);

  if (subscription.isError) {
    return (
      <div className="min-h-screen bg-background px-4 py-10 text-foreground" data-theme={theme}>
        <div className="mx-auto flex min-h-screen max-w-[480px] items-center justify-center">
          <EmptyState description="This subscription link was rotated or is no longer available." title="This link is no longer valid" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground" data-theme={theme}>
      <div className="min-h-screen bg-grid px-4 py-8 sm:py-10">
        <div className="mx-auto w-full max-w-[480px] space-y-6">
          <header className="space-y-4 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
              <Shield className="size-5" />
            </div>
            <div className="space-y-2">
              <div className="t-hero">MyVPN</div>
              <p className="text-sm text-muted-foreground">Your secure connection</p>
            </div>
          </header>

          <Card>
            <CardContent className="flex flex-col items-center gap-5 p-6">
              {subscription.isLoading ? (
                <Skeleton className="aspect-square w-full max-w-[260px]" />
              ) : (
                <img alt="Subscription QR" className="w-full max-w-[260px] rounded-md border border-border bg-white p-4" src={data?.qr.subscription} />
              )}
              <Button
                className="w-full"
                leadingIcon={<Link2 className="size-4" />}
                onClick={async () => {
                  if (!data?.subscription) return;
                  await navigator.clipboard.writeText(data.subscription);
                  toast.success('Subscription link copied');
                }}
                size="lg"
                type="button"
              >
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
                  <TrafficBar animated total={data?.usage.traffic_limit ?? 0} used={data?.usage.traffic_used ?? 0} />
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <div className="t-label">Used</div>
                      <div className="text-xl font-semibold text-foreground">{relativeExpiry(data?.usage.expires_at ?? null) === 'Never expires' ? 'Unlimited plan' : `${Math.round(((data?.usage.traffic_limit ?? 0) > 0 ? ((data?.usage.traffic_used ?? 0) / (data?.usage.traffic_limit ?? 1)) * 100 : 0))}%`}</div>
                      <div className="text-sm text-muted-foreground">
                        {(data?.usage.traffic_limit ?? 0) > 0
                          ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format((data?.usage.traffic_used ?? 0) / 1024 / 1024 / 1024)} GB of ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format((data?.usage.traffic_limit ?? 0) / 1024 / 1024 / 1024)} GB`
                          : 'No hard traffic cap'}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="t-label">Expires</div>
                      <div className={expiryDays !== null && expiryDays < 3 ? 'text-xl font-semibold text-warning' : 'text-xl font-semibold text-foreground'}>
                        {relativeExpiry(data?.usage.expires_at ?? null)}
                      </div>
                      <div className="text-sm text-muted-foreground">{data?.usage.expires_at ? formatDate(data.usage.expires_at) : 'No expiry date'}</div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="t-label">Connect with one tap</div>
              {clientLinks[os].map((client) => (
                <a
                  className="flex min-h-11 items-center gap-3 rounded-md border border-border bg-surface-elevated px-3 py-3 transition hover:border-border-strong hover:bg-[hsl(var(--hover-overlay))]"
                  href={client.href}
                  key={client.label}
                  rel="noreferrer"
                  target="_blank"
                >
                  <img alt="" className="size-10 rounded-md" src={client.icon} />
                  <span className="flex-1 text-sm font-medium text-foreground">{client.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </a>
              ))}
            </CardContent>
          </Card>

          <details className="rounded-lg border border-border bg-surface">
            <summary className="cursor-pointer list-none px-4 py-4 text-sm font-medium text-foreground">How to connect?</summary>
            <div className="space-y-3 border-t border-border px-4 py-4">
              <HelpSection
                steps={[
                  'Install a client such as Streisand, Karing, or Shadowrocket.',
                  'Open the app and choose import by link or scan QR.',
                  'Paste the subscription URL or scan the main QR above.',
                ]}
                title="iOS"
              />
              <HelpSection
                steps={[
                  'Install v2rayNG, Hiddify, or Karing from a trusted release.',
                  'Choose import from clipboard or scan QR code.',
                  'Refresh the subscription inside the app when your link rotates.',
                ]}
                title="Android"
              />
              <HelpSection
                steps={[
                  'Install Hiddify or sing-box on the desktop.',
                  'Import via subscription URL or scan the QR with the client camera.',
                  'Keep the subscription entry enabled for automatic updates.',
                ]}
                title="Desktop"
              />
            </div>
          </details>

          <details className="rounded-lg border border-border bg-surface">
            <summary className="cursor-pointer list-none px-4 py-4 text-sm font-medium text-foreground">Advanced</summary>
            <div className="space-y-4 border-t border-border px-4 py-4">
              {subscription.isLoading ? (
                <>
                  <Skeleton className="h-44 w-full" />
                  <Skeleton className="h-44 w-full" />
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <AdvancedCard image={data?.qr.vless} label="VLESS" value={data?.vless ?? ''} />
                    <AdvancedCard image={data?.qr.hysteria2} label="Hysteria 2" value={data?.hysteria2 ?? ''} />
                  </div>
                  <AdvancedCard image={data?.qr.subscription} label="Subscription" value={data?.subscription ?? ''} />
                </>
              )}
            </div>
          </details>

          <div className="flex justify-center">
            <SecondaryButton
              busy={rotateLink.isPending}
              leadingIcon={<RotateCcw className="size-4" />}
              onClick={() => rotateLink.mutate()}
              type="button"
            >
              Reset my link
            </SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdvancedCard({ image, label, value }: { image?: string; label: string; value: string }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-elevated p-4">
      <div className="t-label">{label}</div>
      {image ? <img alt={label} className="w-full rounded-sm bg-white p-3" src={image} /> : <div className="aspect-square rounded-sm border border-border bg-surface" />}
      <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-foreground">{value}</div>
      <CopyButton className="w-full" value={value} />
    </div>
  );
}

function HelpSection({ steps, title }: { steps: string[]; title: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-4">
      <div className="t-label mb-3">{title}</div>
      <div className="space-y-2">
        {steps.map((step) => (
          <div className="text-sm text-muted-foreground" key={step}>
            {step}
          </div>
        ))}
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
