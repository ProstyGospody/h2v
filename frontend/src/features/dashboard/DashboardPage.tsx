import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, Ban, Radio, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import { AuditEntry, OverviewStats, TrafficPoint } from '@/shared/api/types';
import { formatBytes, formatNumber, formatShortDateTime } from '@/shared/lib/format';

const ranges = ['1', '7', '30'] as const;
type Range = (typeof ranges)[number];

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
  });
  const recentActivity = useQuery({
    queryKey: ['audit', 'recent'],
    queryFn: () => apiClient.request<AuditEntry[]>('/audit?limit=4'),
  });

  const data = overview.data;

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

      <div className="grid gap-4 px-5 pt-6 sm:px-8 md:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          icon={<Users className="size-4" />}
          label="Active users"
          loading={overview.isLoading}
          note={`${formatNumber(data?.expired_users ?? 0)} expired`}
          value={formatNumber(data?.active_users ?? 0)}
        />
        <StatsCard
          icon={<Activity className="size-4" />}
          label="Today traffic"
          loading={overview.isLoading}
          note={`${formatNumber(data?.limited_users ?? 0)} limited`}
          value={formatBytes(data?.today_traffic ?? 0)}
        />
        <StatsCard
          icon={<Radio className="size-4" />}
          label="Online"
          loading={overview.isLoading}
          value={formatNumber(data?.online_users?.length ?? 0)}
        />
        <StatsCard
          icon={<Ban className="size-4" />}
          label="Disabled"
          loading={overview.isLoading}
          value={formatNumber(data?.disabled_users ?? 0)}
        />
      </div>

      <div className="grid gap-4 px-5 pt-4 sm:px-8 xl:grid-cols-[1.75fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle>Traffic</CardTitle>
              <div className="hidden items-center gap-4 text-xs md:flex">
                <Legend color="hsl(var(--primary))" label="Download" />
                <Legend color="hsl(var(--success))" label="Upload" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {traffic.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={traffic.data ?? []} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trafficDown" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.38} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="trafficUp" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
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
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
                      }}
                      formatter={(value, name) => [formatBytes(Number(value)), name === 'downlink' ? 'Download' : 'Upload']}
                      labelFormatter={(v) => formatShortDateTime(v)}
                    />
                    <Area dataKey="downlink" fill="url(#trafficDown)" name="downlink" stroke="hsl(var(--primary))" strokeWidth={2} type="monotone" />
                    <Area dataKey="uplink" fill="url(#trafficUp)" name="uplink" stroke="hsl(var(--success))" strokeWidth={2} type="monotone" />
                  </AreaChart>
                </ResponsiveContainer>
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

      <div className="grid gap-4 px-5 pt-4 sm:px-8 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kernels</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <KernelStatusRow label="Xray" value={data?.xray_status ?? 'Unknown'} />
            <KernelStatusRow label="Hysteria" value={data?.hysteria_status ?? 'Unknown'} />
            <KernelStatusRow label="Traffic feed" value={traffic.data?.length ? 'Receiving' : 'Waiting'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {recentActivity.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : recentActivity.data?.length ? (
              recentActivity.data.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition hover:bg-accent"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-foreground">{entry.action}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {entry.target_type}
                      {entry.target_id ? `:${entry.target_id}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    {formatShortDateTime(entry.created_at)}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">No recent activity.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatsCard({
  icon,
  label,
  loading,
  note,
  value,
}: {
  icon: ReactNode;
  label: string;
  loading: boolean;
  note?: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{icon}</span>
          <span className="t-label">{label}</span>
        </div>
        {loading ? <Skeleton className="h-7 w-24" /> : <div className="t-metric text-foreground">{value}</div>}
        {loading ? (
          <Skeleton className="h-3 w-28" />
        ) : note ? (
          <div className="text-xs text-muted-foreground">{note}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function KernelStatusRow({ label, value }: { label: string; value: string }) {
  const running = value.toLowerCase().includes('run') || value.toLowerCase().includes('ok');

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            running ? 'bg-success animate-pulse-ring' : 'bg-warning',
          )}
        />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
