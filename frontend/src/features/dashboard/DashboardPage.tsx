import { useMemo, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, Ban, Cpu, HardDrive, Radio, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import { OverviewStats, TrafficPoint } from '@/shared/api/types';
import { formatBytes, formatNumber, formatShortDateTime } from '@/shared/lib/format';

const ranges = ['1', '7', '30'] as const;
type Range = (typeof ranges)[number];

const trafficChartConfig = {
  total: {
    label: 'Traffic',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

function formatPercent(value: number | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(1)}%`;
}

function usageTone(value: number | undefined) {
  const v = value ?? 0;
  if (v >= 85) return 'bg-destructive';
  if (v >= 70) return 'bg-warning';
  return 'bg-primary';
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
  const kernelRows = [
    { label: 'Xray', value: data?.xray_status ?? 'Unknown' },
    { label: 'Hysteria', value: data?.hysteria_status ?? 'Unknown' },
    { label: 'Traffic feed', value: traffic.data?.length ? 'Receiving' : 'Waiting' },
  ];

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
          icon={Users}
          label="Active users"
          loading={overview.isLoading}
          value={formatNumber(data?.active_users ?? 0)}
        />
        <MetricCard
          icon={Activity}
          label="Today traffic"
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
          icon={HardDrive}
          label="Memory"
          loading={overview.isLoading}
          value={formatPercent(memoryPercent)}
        />
        <MetricCard
          accent="success"
          icon={Radio}
          label="Online"
          loading={overview.isLoading}
          value={formatNumber(data?.online_users?.length ?? 0)}
        />
        <MetricCard
          accent="muted"
          icon={Ban}
          label="Disabled"
          loading={overview.isLoading}
          value={formatNumber(data?.disabled_users ?? 0)}
        />
      </div>

      <div className="grid gap-3 px-page pt-4 sm:gap-4 xl:grid-cols-[1.75fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Traffic</CardTitle>
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                last {days}d
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-70 sm:h-80">
              {traffic.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : trafficData.length ? (
                <ChartContainer className="h-full w-full aspect-auto" config={trafficChartConfig}>
                  <BarChart data={trafficData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      axisLine={false}
                      dataKey="recorded_at"
                      minTickGap={30}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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
                      cursor={{ fill: 'hsl(var(--accent))', opacity: 0.35 }}
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [formatBytes(Number(value)), 'Traffic']}
                          labelFormatter={(v) => formatShortDateTime(String(v))}
                        />
                      }
                    />
                    <Bar dataKey="total" fill="var(--color-total)" name="total" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No traffic samples yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Online now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {overview.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : data?.online_users?.length ? (
              data.online_users.map((entry) => (
                <div
                  key={`${entry.username}-${entry.recorded_at}`}
                  className="flex items-center justify-between rounded-md px-2 py-2 transition hover:bg-accent/60"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{entry.username}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {formatShortDateTime(entry.recorded_at)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-xs text-foreground">
                    <ArrowDown className="size-3 text-primary" />
                    {formatBytes(entry.bytes)}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">No active sessions.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 px-page pt-4 sm:gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Kernels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {kernelRows.map((row) => {
              const v = row.value.toLowerCase();
              const running = v.includes('run') || v.includes('ok') || v.includes('receiv');
              return (
                <div className="flex items-center justify-between rounded-md px-2 py-2.5" key={row.label}>
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        running ? 'bg-success animate-pulse-ring' : 'bg-warning',
                      )}
                    />
                    <span className="text-sm text-foreground">{row.label}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">{row.value}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  accent = 'primary',
  bar,
  icon: Icon,
  label,
  loading,
  value,
}: {
  accent?: 'primary' | 'success' | 'muted';
  bar?: { percent: number; tone: string };
  icon: ComponentType<{ className?: string }>;
  label: string;
  loading?: boolean;
  value: string;
}) {
  const accentClasses = {
    primary: 'bg-primary/12 text-primary',
    success: 'bg-success/12 text-success',
    muted: 'bg-muted text-muted-foreground',
  } as const;

  return (
    <Card className="bg-card/95 transition-colors hover:bg-[hsl(var(--surface-elevated))]">
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="t-label">{label}</span>
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              accentClasses[accent],
            )}
          >
            <Icon className="size-4" />
          </span>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="t-metric text-foreground">{value}</div>
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
      </CardContent>
    </Card>
  );
}
