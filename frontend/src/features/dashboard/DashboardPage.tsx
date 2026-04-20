import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, ShieldCheck, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '@/shared/api/client';
import { AuditEntry, OverviewStats, TrafficPoint } from '@/shared/api/types';
import { formatBytes, formatNumber, formatShortDateTime } from '@/shared/lib/format';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  KernelIndicator,
  MetricCard,
  PageHeader,
  Skeleton,
} from '@/shared/ui/primitives';

const ranges = [1, 7, 30] as const;

export function DashboardPage() {
  const [days, setDays] = useState<(typeof ranges)[number]>(7);

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
    <div className="pb-8">
      <PageHeader
        title="Overview"
        subtitle="Panel, kernels, and user state in one place."
        action={
          <>
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface-elevated p-1">
              {ranges.map((range) => (
                <button
                  key={range}
                  className={
                    range === days
                      ? 'rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                      : 'rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground'
                  }
                  onClick={() => setDays(range)}
                  type="button"
                >
                  {range}D
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">Refreshes every 10s</div>
          </>
        }
      />

      <div className="grid gap-4 px-5 pt-5 sm:px-6 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Users className="size-4" />}
          label="Active users"
          note={`${formatNumber(data?.expired_users ?? 0)} expired`}
          value={overview.isLoading ? <Skeleton className="h-8 w-20" /> : formatNumber(data?.active_users ?? 0)}
        />
        <MetricCard
          icon={<Activity className="size-4" />}
          label="Today traffic"
          note={`${formatNumber(data?.limited_users ?? 0)} limited`}
          value={overview.isLoading ? <Skeleton className="h-8 w-28" /> : formatBytes(data?.today_traffic ?? 0)}
        />
        <MetricCard
          icon={<ShieldCheck className="size-4" />}
          label="Xray"
          note="Kernel status"
          value={overview.isLoading ? <Skeleton className="h-8 w-24" /> : data?.xray_status ?? 'Unknown'}
        />
        <MetricCard
          icon={<ShieldCheck className="size-4" />}
          label="Hysteria"
          note={`${formatNumber(data?.disabled_users ?? 0)} disabled`}
          value={overview.isLoading ? <Skeleton className="h-8 w-24" /> : data?.hysteria_status ?? 'Unknown'}
        />
      </div>

      <div className="grid gap-6 px-5 pt-6 sm:px-6 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Traffic</CardTitle>
            <CardDescription>Upload and download over the last {days} days.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              {traffic.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={traffic.data ?? []} margin={{ left: 8, right: 8, top: 16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trafficDown" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
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
                      tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      tickFormatter={(value) => formatBytes(Number(value))}
                      tickLine={false}
                      width={82}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--surface-elevated))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      formatter={(value, name) => [formatBytes(Number(value)), name === 'downlink' ? 'Download' : 'Upload']}
                      labelFormatter={(value) => formatShortDateTime(value)}
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
            <CardDescription>Recent active sessions and bandwidth snapshots.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {overview.isLoading
              ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)
              : (data?.online_users ?? []).map((entry) => (
                  <div key={`${entry.username}-${entry.recorded_at}`} className="flex items-center justify-between rounded-md border border-border bg-surface-elevated px-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-success shadow-[0_0_0_0_hsl(var(--success)/0.6)] [animation:pulse-ring_2s_ease-out_infinite]" />
                        <span className="truncate text-sm font-medium text-foreground">{entry.username}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatShortDateTime(entry.recorded_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1 text-sm text-foreground">
                        <ArrowDown className="size-3.5 text-primary" />
                        {formatBytes(entry.bytes)}
                      </div>
                    </div>
                  </div>
                ))}
            {!overview.isLoading && !data?.online_users?.length ? <div className="text-sm text-muted-foreground">No recent active sessions.</div> : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 px-5 pt-6 sm:px-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Kernel status</CardTitle>
            <CardDescription>Core process health from the latest overview sample.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <KernelIndicator label="Xray" value={data?.xray_status ?? 'Unknown'} />
            <KernelIndicator label="Hysteria" value={data?.hysteria_status ?? 'Unknown'} />
            <KernelIndicator label="Traffic feed" value={traffic.data?.length ? 'Receiving samples' : 'Waiting for samples'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest administrative actions touching the panel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivity.isLoading
              ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)
              : recentActivity.data?.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border bg-surface-elevated px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{entry.action}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {entry.target_type}:{entry.target_id || 'N/A'}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">{formatShortDateTime(entry.created_at)}</div>
                    </div>
                  </div>
                ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
