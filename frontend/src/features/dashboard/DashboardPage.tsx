import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
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
type MetricIconName = 'network' | 'traffic' | 'cpu' | 'memory' | 'online' | 'disabled';

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
          icon="network"
          label="Network Speed"
          loading={overview.isLoading}
        />
        <MetricCard
          icon="traffic"
          label="Today traffic"
          loading={overview.isLoading}
          value={formatBytes(data?.today_traffic ?? 0)}
        />
        <MetricCard
          bar={{ percent: cpuPercent ?? 0, tone: usageTone(cpuPercent) }}
          icon="cpu"
          label="CPU"
          loading={overview.isLoading}
          value={formatPercent(cpuPercent)}
        />
        <MetricCard
          bar={{ percent: memoryPercent ?? 0, tone: usageTone(memoryPercent) }}
          icon="memory"
          label="Memory"
          loading={overview.isLoading}
          value={formatPercent(memoryPercent)}
        />
        <MetricCard
          icon="online"
          label="Online"
          loading={overview.isLoading}
          value={formatNumber(data?.online_users?.length ?? 0)}
        />
        <MetricCard
          icon="disabled"
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

function DashboardMetricIcon({
  className,
  name,
}: {
  className?: string;
  name: MetricIconName;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn('block', className)}
      focusable="false"
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
    >
      {metricIconShape(name)}
    </svg>
  );
}

function metricIconShape(name: MetricIconName): ReactNode {
  switch (name) {
    case 'network':
      return (
        <>
          <polygon fill="#e9fff7" points="8 24 25 9 25 18 44 18 44 29 25 29 25 39" />
          <polygon fill="#ffbc00" points="56 40 39 55 39 46 20 46 20 35 39 35 39 25" />
          <polygon fill="#f08a24" points="26 28 38 28 34 36 22 36" />
        </>
      );
    case 'traffic':
      return (
        <>
          <polygon fill="#e9fff7" points="10 50 10 34 22 34 22 50" />
          <polygon fill="#e9fff7" points="26 50 26 22 38 22 38 50" />
          <polygon fill="#ffbc00" points="42 50 42 12 54 12 54 50" />
          <polygon fill="#f08a24" points="8 54 56 54 56 58 8 58" />
        </>
      );
    case 'cpu':
      return (
        <>
          <polygon fill="#e9fff7" points="18 12 46 12 52 18 52 46 46 52 18 52 12 46 12 18" />
          <polygon fill="#0b1010" points="23 22 42 22 42 41 22 41 22 23" />
          <polygon fill="#ffbc00" points="27 27 37 27 37 37 27 37" />
          <polygon fill="#f08a24" points="8 20 12 20 12 27 8 27" />
          <polygon fill="#f08a24" points="52 37 56 37 56 44 52 44" />
          <polygon fill="#f08a24" points="27 8 35 8 35 12 27 12" />
          <polygon fill="#f08a24" points="30 52 38 52 38 56 30 56" />
        </>
      );
    case 'memory':
      return (
        <>
          <polygon fill="#e9fff7" points="9 21 55 21 55 42 50 47 14 47 9 42" />
          <polygon fill="#0b1010" points="16 28 22 28 22 38 16 38" />
          <polygon fill="#0b1010" points="26 28 32 28 32 38 26 38" />
          <polygon fill="#0b1010" points="36 28 42 28 42 38 36 38" />
          <polygon fill="#ffbc00" points="14 47 20 47 18 56 12 56" />
          <polygon fill="#ffbc00" points="25 47 31 47 30 56 24 56" />
          <polygon fill="#ffbc00" points="36 47 42 47 43 56 37 56" />
          <polygon fill="#ffbc00" points="47 47 53 47 56 56 50 56" />
        </>
      );
    case 'online':
      return (
        <>
          <polygon fill="#e9fff7" points="7 26 32 9 57 26 50 34 32 22 14 34" />
          <polygon fill="#e9fff7" points="18 40 32 29 46 40 39 47 32 41 25 47" />
          <polygon fill="#ffbc00" points="27 53 32 47 37 53 32 58" />
          <polygon fill="#f08a24" points="29 36 32 34 35 36 32 39" />
        </>
      );
    case 'disabled':
      return (
        <>
          <polygon fill="#e9fff7" points="26 9 38 9 44 16 44 28 38 35 26 35 20 28 20 16" />
          <polygon fill="#e9fff7" points="13 56 17 43 47 43 51 56" />
          <polygon fill="#ffbc00" points="12 7 19 7 53 57 46 57" />
          <polygon fill="#f08a24" points="16 7 19 7 53 57 50 57" />
        </>
      );
  }
}

function MetricCard({
  bar,
  footer,
  icon,
  label,
  loading,
  value,
}: {
  bar?: { percent: number; tone: string };
  footer?: ReactNode;
  icon: MetricIconName;
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
              'flex size-10 shrink-0 items-center justify-center rounded-md border border-border/45 bg-muted/45',
            )}
          >
            <DashboardMetricIcon className="size-8" name={icon} />
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
