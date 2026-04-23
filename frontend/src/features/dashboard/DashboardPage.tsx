import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, Ban, Radio, ShieldCheck, Users } from 'lucide-react';
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
  OnlineDot,
  PageHeader,
  Skeleton,
  cn,
} from '@/shared/ui/primitives';

const ranges = [1, 7, 30] as const;
type Range = (typeof ranges)[number];

export function DashboardPage() {
  const [days, setDays] = useState<Range>(7);

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
  const kernelRunning = (status?: string) => (status ?? '').toLowerCase().includes('run');

  return (
    <div className="pb-8">
      <PageHeader
        title="Overview"
        subtitle="Panel, kernels, and user state in one place."
        action={
          <>
            <RangeToggle onChange={setDays} value={days} />
            <div className="hidden text-xs text-muted-foreground sm:block">Refreshes every 10s</div>
          </>
        }
      />

      <div className="grid gap-4 px-5 pt-6 sm:px-8 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Users className="size-4" />}
          label="Active users"
          loading={overview.isLoading}
          note={`${formatNumber(data?.expired_users ?? 0)} expired`}
          value={formatNumber(data?.active_users ?? 0)}
        />
        <MetricCard
          icon={<Activity className="size-4" />}
          label="Today traffic"
          loading={overview.isLoading}
          note={`${formatNumber(data?.limited_users ?? 0)} limited`}
          value={formatBytes(data?.today_traffic ?? 0)}
        />
        <MetricCard
          icon={<Radio className="size-4" />}
          label="Online now"
          loading={overview.isLoading}
          note="Last 60 seconds"
          value={formatNumber(data?.online_users?.length ?? 0)}
        />
        <MetricCard
          icon={<Ban className="size-4" />}
          label="Disabled"
          loading={overview.isLoading}
          note="Manually blocked"
          value={formatNumber(data?.disabled_users ?? 0)}
        />
      </div>

      <div className="grid gap-6 px-5 pt-6 sm:px-8 xl:grid-cols-[1.75fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Traffic</CardTitle>
                <CardDescription>Upload and download over the last {days} day{days > 1 ? 's' : ''}.</CardDescription>
              </div>
              <div className="hidden items-center gap-4 text-xs md:flex">
                <LegendSwatch color="hsl(var(--primary))" label="Download" />
                <LegendSwatch color="hsl(var(--success))" label="Upload" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
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
                      tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      tickFormatter={(value) => formatBytes(Number(value))}
                      tickLine={false}
                      width={72}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--surface-elevated))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
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
            <CardDescription>Active sessions with recent bandwidth.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {overview.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)
            ) : data?.online_users?.length ? (
              data.online_users.map((entry) => (
                <div
                  key={`${entry.username}-${entry.recorded_at}`}
                  className="flex items-center justify-between rounded-md border border-border bg-surface-elevated px-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <OnlineDot />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{entry.username}</div>
                      <div className="text-xs text-muted-foreground">{formatShortDateTime(entry.recorded_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-foreground">
                    <ArrowDown className="size-3.5 text-primary" />
                    <span className="font-mono text-xs">{formatBytes(entry.bytes)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">No active sessions.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 px-5 pt-6 sm:px-8 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kernel status</CardTitle>
            <CardDescription>Core process health from the latest overview sample.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0">
            <KernelIndicator label="Xray" value={data?.xray_status ?? 'Unknown'} />
            <KernelIndicator label="Hysteria" value={data?.hysteria_status ?? 'Unknown'} />
            <KernelIndicator label="Traffic feed" value={traffic.data?.length ? 'Receiving samples' : 'Waiting for samples'} />
            {overview.data ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck
                  className={cn(
                    'size-3.5',
                    kernelRunning(data?.xray_status) && kernelRunning(data?.hysteria_status) ? 'text-success' : 'text-warning',
                  )}
                />
                {kernelRunning(data?.xray_status) && kernelRunning(data?.hysteria_status)
                  ? 'All kernels running normally'
                  : 'One or more kernels need attention'}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest administrative actions touching the panel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {recentActivity.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)
            ) : recentActivity.data?.length ? (
              recentActivity.data.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-elevated px-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-foreground">{entry.action}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {entry.target_type}:{entry.target_id || '—'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">{formatShortDateTime(entry.created_at)}</div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">No recent activity.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RangeToggle({ onChange, value }: { onChange: (range: Range) => void; value: Range }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-elevated p-0.5">
      {ranges.map((range) => (
        <button
          key={range}
          className={
            range === value
              ? 'rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
              : 'rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground'
          }
          onClick={() => onChange(range)}
          type="button"
        >
          {range}D
        </button>
      ))}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
