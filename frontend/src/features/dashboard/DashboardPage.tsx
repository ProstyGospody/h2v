import { useId, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ChartColumnIncreasing,
  Cpu,
  MemoryStick,
  Network,
  Timer,
  UserRoundX,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import type { OverviewStats, TrafficPoint } from '@/shared/api/types';
import { useI18n } from '@/shared/i18n/i18n';
import {
  formatBytes,
  formatBytesPerSecond,
  formatDurationCompact,
  formatMonthDay,
  formatNumber,
  formatPercent,
  formatShortDateTime,
} from '@/shared/lib/format';

const ranges = ['1', '7', '30'] as const;
type Range = (typeof ranges)[number];
type StatusTone = 'ok' | 'warn' | 'idle';

type DashboardServiceItem = {
  icon?: LucideIcon;
  label: string;
  logo?: CoreLogoName;
  showIndicator?: boolean;
  showValue?: boolean;
  tone?: StatusTone;
  value: string;
};

function usageTone(value: number | undefined) {
  const v = value ?? 0;
  if (v >= 85) return 'bg-destructive';
  if (v >= 70) return 'bg-warning';
  return 'bg-accent-gradient';
}

export function DashboardPage() {
  const { locale, t } = useI18n();
  const [days, setDays] = useState<Range>('7');

  const overview = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiClient.request<OverviewStats>('/stats/overview'),
    refetchInterval: 10_000,
  });
  const traffic = useQuery({
    queryKey: ['stats', 'traffic', days],
    queryFn: () => apiClient.request<TrafficPoint[]>(`/stats/traffic?days=${days}`),
    refetchInterval: 10_000,
  });

  const data = overview.data;
  const cpuPercent = data?.cpu_usage_percent;
  const memoryPercent = data?.memory_usage_percent;
  const trafficData = useMemo(
    () => (traffic.data ?? []).map((p) => ({ recorded_at: p.recorded_at, total: p.uplink + p.downlink })),
    [traffic.data],
  );
  const trafficChartConfig = useMemo<ChartConfig>(
    () => ({
      total: {
        label: t('dashboard.chart.transfer'),
        color: 'var(--gradient-accent)',
      },
    }),
    [t],
  );
  const hasTrafficSamples = trafficData.some((p) => p.total > 0);
  const serviceStatuses: DashboardServiceItem[] = [
    {
      label: t('shell.uptime'),
      icon: Timer,
      value: formatDurationCompact(data?.uptime_seconds, locale),
      showIndicator: false,
      showValue: true,
    },
    {
      label: 'Xray',
      logo: 'xray',
      tone: serviceTone(data?.xray_status, overview.isError),
      value: serviceStatusLabel(data?.xray_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
      showValue: false,
    },
    {
      label: 'Hysteria 2',
      logo: 'hysteria',
      tone: serviceTone(data?.hysteria_status, overview.isError),
      value: serviceStatusLabel(data?.hysteria_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
      showValue: false,
    },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        center={<ServiceStatusIsland items={serviceStatuses} label={t('nav.services')} />}
        title={t('dashboard.overview')}
        action={
          <Tabs onValueChange={(v) => setDays(v as Range)} value={days}>
            <TabsList>
              {ranges.map((r) => (
                <TabsTrigger key={r} value={r}>
                  {t('dashboard.rangeDay', { days: r })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid auto-rows-fr grid-cols-2 gap-2.5 px-page pt-5 sm:grid-cols-3 sm:gap-3 2xl:grid-cols-6">
        <MetricCard
          value={
            <NetworkSpeedValue
              rx={data?.network_rx_bytes_per_second ?? 0}
              tx={data?.network_tx_bytes_per_second ?? 0}
            />
          }
          icon={Network}
          label={t('dashboard.traffic')}
          loading={overview.isLoading}
        />
        <MetricCard
          icon={ChartColumnIncreasing}
          label={t('dashboard.today')}
          loading={overview.isLoading}
          value={formatBytes(data?.today_traffic ?? 0)}
        />
        <MetricCard
          bar={{ percent: cpuPercent ?? 0, tone: usageTone(cpuPercent) }}
          icon={Cpu}
          label="CPU"
          loading={overview.isLoading}
          value={formatPercent(cpuPercent)}
        />
        <MetricCard
          bar={{ percent: memoryPercent ?? 0, tone: usageTone(memoryPercent) }}
          icon={MemoryStick}
          label={t('dashboard.ram')}
          loading={overview.isLoading}
          value={formatPercent(memoryPercent)}
        />
        <MetricCard
          icon={Wifi}
          label={t('dashboard.online')}
          loading={overview.isLoading}
          value={formatNumber(data?.online_users?.length ?? 0, locale)}
        />
        <MetricCard
          icon={UserRoundX}
          label={t('dashboard.disabled')}
          loading={overview.isLoading}
          value={formatNumber(data?.disabled_users ?? 0, locale)}
        />
      </div>

      <div className="px-page pt-4">
        <div className="relative">
          <div className="absolute right-0 top-0 z-10 flex items-center justify-end gap-3">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {t('dashboard.daysRange', { days })}
            </span>
          </div>
          <div className="h-80 pt-6 sm:h-96 xl:h-[420px]">
            {traffic.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : hasTrafficSamples ? (
              <ChartContainer className="h-full w-full aspect-auto" config={trafficChartConfig}>
                <BarChart data={trafficData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardTrafficGradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent-primary)" />
                      <stop offset="100%" stopColor="var(--accent-secondary)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border) / 0.5)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="recorded_at"
                    minTickGap={30}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickFormatter={(v) => formatMonthDay(String(v), locale)}
                    tickLine={false}
                  />
                  <YAxis
                    axisLine={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickFormatter={(v) => formatBytes(Number(v))}
                    tickLine={false}
                    width={64}
                  />
                  <ChartTooltip
                    cursor={{ fill: 'url(#dashboardTrafficGradient)', opacity: 0.18 }}
                    content={
                      <ChartTooltipContent
                        formatter={(value) => [formatBytes(Number(value)), t('dashboard.chart.total')]}
                        labelFormatter={(v) => formatShortDateTime(String(v), locale)}
                      />
                    }
                  />
                  <Bar dataKey="total" fill="url(#dashboardTrafficGradient)" name="total" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t('dashboard.noSamples')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServiceStatusIsland({ items, label }: { items: DashboardServiceItem[]; label: string }) {
  const gradientId = `dashboard-service-icon-${useId().replace(/:/g, '')}`;

  return (
    <section aria-label={label} className="flex max-w-full justify-center">
      <div className="flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-md bg-accent-gradient-soft px-3 py-1.5 shadow-sm">
        <svg aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
          <defs>
            <linearGradient id={gradientId} x1="4" x2="20" y1="4" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--icon-gradient-start)" />
              <stop offset="0.45" stopColor="var(--icon-gradient-mid)" />
              <stop offset="1" stopColor="var(--icon-gradient-end)" />
            </linearGradient>
          </defs>
        </svg>
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <div
              className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1 text-foreground transition-colors hover:bg-muted/25"
              key={item.label}
              title={`${item.label}: ${item.value}`}
            >
              {item.logo || Icon ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full">
                  {item.logo ? (
                    <CoreLogo className={cn(item.logo === 'hysteria' ? 'h-5 w-7' : 'size-5')} core={item.logo} />
                  ) : Icon ? (
                    <Icon className="size-4" stroke={`url(#${gradientId})`} strokeWidth={2.35} />
                  ) : null}
                </span>
              ) : null}
              <span className="min-w-0 truncate text-xs font-medium leading-5">{item.label}</span>
              {item.showValue ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.value}</span>
              ) : null}
              {item.showIndicator ? (
                <span
                  aria-label={item.value}
                  className={cn('size-2 shrink-0 rounded-full ring-2', serviceDotTone(item.tone ?? 'idle'))}
                  title={item.value}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NetworkSpeedValue({ rx, tx }: { rx: number; tx: number }) {
  const { t } = useI18n();
  const gradientId = `network-speed-${useId().replace(/:/g, '')}`;
  const items = [
    { icon: ArrowDown, label: t('dashboard.down'), value: formatBytesPerSecond(rx) },
    { icon: ArrowUp, label: t('dashboard.up'), value: formatBytesPerSecond(tx) },
  ];

  return (
    <div className="grid min-w-0 gap-1">
      <svg aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
        <defs>
          <linearGradient id={gradientId} x1="4" x2="20" y1="4" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--icon-gradient-start)" />
            <stop offset="0.45" stopColor="var(--icon-gradient-mid)" />
            <stop offset="1" stopColor="var(--icon-gradient-end)" />
          </linearGradient>
        </defs>
      </svg>
      {items.map(({ icon: Icon, label, value }) => (
        <div aria-label={label} className="flex min-w-0 items-center gap-1.5" key={label}>
          <Icon className="size-[18px] shrink-0" stroke={`url(#${gradientId})`} strokeWidth={2.35} />
          <span className="min-w-0 truncate font-mono text-sm font-semibold leading-none text-foreground">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function serviceTone(value: string | undefined, isError: boolean): StatusTone {
  if (isError) return 'warn';
  if (!value) return 'idle';
  return value.toLowerCase().startsWith('fail') ? 'warn' : 'ok';
}

function serviceStatusLabel(
  value: string | undefined,
  isLoading: boolean,
  isError: boolean,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (isError) return t('common.issue');
  if (isLoading && !value) return t('common.syncing');
  if (!value) return t('common.unknown');
  return value.toLowerCase().startsWith('fail') ? t('common.issue') : t('common.ok');
}

function serviceDotTone(tone: StatusTone): string {
  if (tone === 'ok') return 'bg-success ring-success/15';
  if (tone === 'warn') return 'bg-warning ring-warning/15';
  return 'bg-muted-foreground ring-muted-foreground/10';
}

function MetricCard({
  bar,
  icon: Icon,
  label,
  loading,
  value,
}: {
  bar?: { percent: number; tone: string };
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  value?: ReactNode;
}) {
  const gradientId = `metric-icon-${useId().replace(/:/g, '')}`;

  return (
    <Card className="metric-card h-full min-h-[90px] border-0 transition-colors hover:bg-[hsl(var(--surface-elevated))]">
      <CardContent className="flex h-full min-w-0 flex-col gap-1.5 p-2.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span className="t-label">{label}</span>
          <span className="relative flex size-6 shrink-0 items-center justify-center">
            <svg aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
              <defs>
                <linearGradient id={gradientId} x1="4" x2="20" y1="4" y2="20" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="var(--icon-gradient-start)" />
                  <stop offset="0.45" stopColor="var(--icon-gradient-mid)" />
                  <stop offset="1" stopColor="var(--icon-gradient-end)" />
                </linearGradient>
              </defs>
            </svg>
            <Icon className="size-6" stroke={`url(#${gradientId})`} strokeWidth={2.35} />
          </span>
        </div>
        <div className="min-w-0">
          {loading ? (
            value !== undefined && value !== null ? (
              <Skeleton className="h-5 w-20" />
            ) : (
              <div className="h-5" />
            )
          ) : typeof value === 'string' ? (
            <div className="truncate text-xl font-semibold leading-none text-foreground">{value}</div>
          ) : value !== undefined && value !== null ? (
            <div className="min-w-0 flex-1">{value}</div>
          ) : (
            <div className="h-5" />
          )}
        </div>
        <div className={cn('h-1.5', !bar && 'hidden')}>
          {bar ? (
            loading ? (
              <Skeleton className="h-1.5 w-full" />
            ) : (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', bar.tone)}
                  style={{ width: `${Math.max(0, Math.min(100, bar.percent))}%` }}
                />
              </div>
            )
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
