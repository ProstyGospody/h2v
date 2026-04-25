import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, Ban, Cpu, HardDrive, Radio, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
      <header className="px-5 pb-2 pt-8 sm:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-[26px] font-semibold leading-none tracking-[-0.01em] text-foreground">
              Overview
            </h1>
          </div>
          <Tabs onValueChange={(v) => setDays(v as Range)} value={days}>
            <TabsList>
              {ranges.map((r) => (
                <TabsTrigger key={r} value={r}>
                  {r}D
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      <div className="grid gap-4 px-5 pt-6 sm:px-8 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="size-4" />
              <span className="t-label">Active users</span>
            </div>
            {overview.isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="t-metric text-foreground">{formatNumber(data?.active_users ?? 0)}</div>
            )}
            {overview.isLoading ? (
              <Skeleton className="h-3 w-28" />
            ) : (
              <div className="text-xs text-muted-foreground">
                {formatNumber(data?.expired_users ?? 0)} expired
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Activity className="size-4" />
              <span className="t-label">Today traffic</span>
            </div>
            {overview.isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="t-metric text-foreground">{formatBytes(data?.today_traffic ?? 0)}</div>
            )}
            {overview.isLoading ? (
              <Skeleton className="h-3 w-28" />
            ) : (
              <div className="text-xs text-muted-foreground">
                {formatNumber(data?.limited_users ?? 0)} limited
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Cpu className="size-4" />
              <span className="t-label">CPU</span>
            </div>
            {overview.isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="t-metric text-foreground">{formatPercent(cpuPercent)}</div>
            )}
            {overview.isLoading ? (
              <Skeleton className="h-2 w-full" />
            ) : (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    (cpuPercent ?? 0) >= 85 ? 'bg-destructive' : (cpuPercent ?? 0) >= 70 ? 'bg-warning' : 'bg-primary',
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, cpuPercent ?? 0))}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <HardDrive className="size-4" />
              <span className="t-label">Memory</span>
            </div>
            {overview.isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="t-metric text-foreground">{formatPercent(memoryPercent)}</div>
            )}
            {overview.isLoading ? (
              <Skeleton className="h-2 w-full" />
            ) : (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    (memoryPercent ?? 0) >= 85 ? 'bg-destructive' : (memoryPercent ?? 0) >= 70 ? 'bg-warning' : 'bg-primary',
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, memoryPercent ?? 0))}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Radio className="size-4" />
              <span className="t-label">Online</span>
            </div>
            {overview.isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="t-metric text-foreground">{formatNumber(data?.online_users?.length ?? 0)}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Ban className="size-4" />
              <span className="t-label">Disabled</span>
            </div>
            {overview.isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <div className="t-metric text-foreground">{formatNumber(data?.disabled_users ?? 0)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 px-5 pt-4 sm:px-8 xl:grid-cols-[1.75fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Traffic</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {traffic.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (
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
                      width={72}
                    />
                    <ChartTooltip
                      cursor={{ fill: 'hsl(var(--accent))', opacity: 0.3 }}
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
                  className="flex items-center justify-between rounded-md px-2 py-2 transition hover:bg-accent"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-foreground">{entry.username}</div>
                      <div className="text-xs text-muted-foreground">{formatShortDateTime(entry.recorded_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-xs text-foreground">
                    <ArrowDown className="size-3 text-primary" />
                    {formatBytes(entry.bytes)}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No active sessions.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 px-5 pt-4 sm:px-8">
        <Card>
          <CardHeader>
            <CardTitle>Kernels</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {kernelRows.map((row) => {
              const running =
                row.value.toLowerCase().includes('run') || row.value.toLowerCase().includes('ok');
              return (
                <div className="flex items-center justify-between py-2" key={row.label}>
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
