import { QRCodeSVG } from 'qrcode.react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { apiClient } from '@/shared/api/client';
import { UserLinks } from '@/shared/api/types';
import { detectOS } from '@/shared/lib/detectOS';
import { formatBytes, relativeExpiry } from '@/shared/lib/format';
import { Button, Card, SecondaryButton } from '@/shared/ui/primitives';

const clientLinks = {
  ios: [
    { label: 'Streisand', href: 'https://apps.apple.com/app/streisand/id6450534064' },
    { label: 'Karing', href: 'https://apps.apple.com/app/karing/id6472431552' },
    { label: 'Shadowrocket', href: 'https://apps.apple.com/app/shadowrocket/id932747118' },
  ],
  android: [
    { label: 'v2rayNG', href: 'https://github.com/2dust/v2rayNG/releases' },
    { label: 'Hiddify', href: 'https://github.com/hiddify/hiddify-next/releases' },
    { label: 'Karing', href: 'https://github.com/KaringX/karing/releases' },
  ],
  desktop: [
    { label: 'Hiddify', href: 'https://github.com/hiddify/hiddify-next/releases' },
    { label: 'sing-box', href: 'https://sing-box.sagernet.org/' },
  ],
} as const;

export function SubPage() {
  const { token } = useParams({ from: '/u/$token' });
  const subscription = useQuery({
    queryKey: ['public-sub', token],
    queryFn: () => apiClient.request<UserLinks>(`/sub/${token}?format=json`),
  });

  const data = subscription.data;
  const os = typeof window !== 'undefined' ? detectOS() : 'desktop';

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2 text-center">
          <div className="text-sm uppercase tracking-[0.12em] text-cyan-300">VPN subscription</div>
          <h1 className="text-3xl font-semibold">{data?.username ?? 'Loading'}</h1>
          <p className="text-sm text-slate-400">Use the QR code or the app buttons for your device.</p>
        </header>

        <Card className="flex flex-col items-center gap-4">
          {data && <QRCodeSVG value={data.subscription} size={300} bgColor="#ffffff" fgColor="#020617" />}
          <Button onClick={() => navigator.clipboard.writeText(data?.subscription ?? '')}>Copy subscription link</Button>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm text-slate-400">Usage</div>
              <div className="mt-2 text-xl font-semibold">
                {formatBytes(data?.usage.traffic_used ?? 0)} of {data?.usage.traffic_limit ? formatBytes(data.usage.traffic_limit) : 'Unlimited'}
              </div>
            </div>
            <div className="text-sm text-slate-400">{relativeExpiry(data?.usage.expires_at ?? null)}</div>
          </div>
          <div className="mt-4 h-2 overflow-hidden bg-white/5">
            <div
              className="h-full bg-cyan-400"
              style={{
                width: `${Math.min(
                  100,
                  data?.usage.traffic_limit ? (data.usage.traffic_used / data.usage.traffic_limit) * 100 : 12,
                )}%`,
              }}
            />
          </div>
        </Card>

        <Card>
          <div className="text-sm text-slate-400">Apps for this device</div>
          <div className="mt-4 flex flex-wrap gap-2">
            {clientLinks[os].map((client) => (
              <a key={client.label} href={client.href} target="_blank" rel="noreferrer">
                <Button type="button">{client.label}</Button>
              </a>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-4 text-sm text-slate-400">Advanced</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <AdvancedBlock title="Subscription" image={data?.qr.subscription} onCopy={() => navigator.clipboard.writeText(data?.subscription ?? '')} />
            <AdvancedBlock title="VLESS" image={data?.qr.vless} onCopy={() => navigator.clipboard.writeText(data?.vless ?? '')} />
            <AdvancedBlock title="Hysteria 2" image={data?.qr.hysteria2} onCopy={() => navigator.clipboard.writeText(data?.hysteria2 ?? '')} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function AdvancedBlock({ title, image, onCopy }: { title: string; image?: string; onCopy: () => void }) {
  return (
    <div className="border border-white/10 bg-slate-900 p-3">
      <div className="mb-3 text-sm text-slate-300">{title}</div>
      {image ? <img alt={title} src={image} className="w-full bg-white" /> : <div className="aspect-square bg-white/5" />}
      <SecondaryButton className="mt-3 w-full" onClick={onCopy}>
        Copy
      </SecondaryButton>
    </div>
  );
}

