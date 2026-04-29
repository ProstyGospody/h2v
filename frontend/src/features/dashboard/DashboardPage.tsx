import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ChartNoAxesColumnIncreasing,
  ChartNetwork,
  CircleGauge,
  MemoryStick,
  UserRoundX,
  WifiHigh,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import type { OverviewStats, TrafficPoint } from '@/shared/api/types';
import {
  formatBytes,
  formatBytesPerSecond,
  formatDate,
  formatNumber,
  formatPercent,
  formatShortDateTime,
} from '@/shared/lib/format';

const ranges = ['1', '7', '30'] as const;
type Range = (typeof ranges)[number];

const trafficChartConfig = {
  total: {
    label: 'Transfer',
    color: 'var(--gradient-accent)',
  },
} satisfies ChartConfig;

function usageTone(value: number | undefined) {
  const v = value ?? 0;
  if (v >= 85) return 'bg-destructive';
  if (v >= 70) return 'bg-warning';
  return 'bg-accent-gradient';
}

export function DashboardPage() {
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

  return (
    <div className="pb-10">
      <PageHeader
        title="Overview"
        action={
          <Tabs onValueChange={(v) => setDays(v as Range)} value={days}>
            <TabsList>
              {ranges.map((r) => (
                <TabsTrigger key={r} value={r}>
                  {r}D
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid gap-3 px-page pt-6 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          footer={
            <NetworkSpeedValue
              rx={data?.network_rx_bytes_per_second ?? 0}
              tx={data?.network_tx_bytes_per_second ?? 0}
            />
          }
          icon={ChartNetwork}
          label="Network Speed"
          loading={overview.isLoading}
        />
        <MetricCard
          icon={ChartNoAxesColumnIncreasing}
          label="Today traffic"
          loading={overview.isLoading}
          value={formatBytes(data?.today_traffic ?? 0)}
        />
        <MetricCard
          bar={{ percent: cpuPercent ?? 0, tone: usageTone(cpuPercent) }}
          icon={CircleGauge}
          label="CPU"
          loading={overview.isLoading}
          value={formatPercent(cpuPercent)}
        />
        <MetricCard
          bar={{ percent: memoryPercent ?? 0, tone: usageTone(memoryPercent) }}
          icon={MemoryStick}
          label="Memory"
          loading={overview.isLoading}
          value={formatPercent(memoryPercent)}
        />
        <MetricCard
          icon={WifiHigh}
          label="Online"
          loading={overview.isLoading}
          value={formatNumber(data?.online_users?.length ?? 0)}
        />
        <MetricCard
          icon={UserRoundX}
          label="Disabled"
          loading={overview.isLoading}
          value={formatNumber(data?.disabled_users ?? 0)}
        />
      </div>

      <div className="px-page pt-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-end gap-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                last {days}d
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-80 sm:h-96 xl:h-[420px]">
              {traffic.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : trafficData.length ? (
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
                      tickFormatter={(v) => formatDate(String(v), 'MMM d')}
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
                          formatter={(value) => [formatBytes(Number(value)), 'Total']}
                          labelFormatter={(v) => formatShortDateTime(String(v))}
                        />
                      }
                    />
                    <Bar dataKey="total" fill="url(#dashboardTrafficGradient)" name="total" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No samples yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NetworkSpeedValue({ rx, tx }: { rx: number; tx: number }) {
  return (
    <div className="flex min-w-0 items-center gap-4 text-xs font-semibold leading-none text-foreground">
      <span aria-label="Download" className="inline-flex min-w-0 items-center gap-1.5" title="Download">
        <ArrowDown className="size-3.5 text-primary" />
        <span className="font-mono">{formatBytesPerSecond(rx)}</span>
      </span>
      <span aria-label="Upload" className="inline-flex min-w-0 items-center gap-1.5" title="Upload">
        <ArrowUp className="size-3.5 text-primary" />
        <span className="font-mono">{formatBytesPerSecond(tx)}</span>
      </span>
    </div>
  );
}

function MetricCard({
  bar,
  footer,
  icon: Icon,
  label,
  loading,
  value,
}: {
  bar?: { percent: number; tone: string };
  footer?: ReactNode;
  icon: ComponentType<{ className?: string }>;
  label: string;
  loading?: boolean;
  value?: ReactNode;
}) {
  return (
    <Card className="h-full transition-colors hover:bg-[hsl(var(--surface-elevated))]">
      <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="t-label">{label}</span>
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/65 text-primary',
            )}
          >
            <Icon className="size-5" />
          </span>
        </div>
        {loading ? (
          value !== undefined && value !== null ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <div className="h-7" />
          )
        ) : typeof value === 'string' ? (
          <div className="t-metric text-foreground">{value}</div>
        ) : value !== undefined && value !== null ? (
          value
        ) : (
          <div className="h-7" />
        )}
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
        {footer ? (
          <div className="mt-auto">
            {loading ? <Skeleton className="h-4 w-full" /> : footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
