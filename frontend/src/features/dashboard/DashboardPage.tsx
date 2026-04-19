import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiClient } from '@/shared/api/client';
import { OverviewStats, TrafficPoint } from '@/shared/api/types';
import { formatBytes } from '@/shared/lib/format';
import { Card, PageHeader } from '@/shared/ui/primitives';

export function DashboardPage() {
  const overview = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiClient.request<OverviewStats>('/stats/overview'),
    refetchInterval: 5_000,
  });
  const traffic = useQuery({
    queryKey: ['stats', 'traffic'],
    queryFn: () => apiClient.request<TrafficPoint[]>('/stats/traffic?days=7'),
  });

  const data = overview.data;

  return (
    <div>
      <PageHeader title="Overview" subtitle="Panel, kernel, and user state in one place." />
      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
        <Metric title="Active users" value={String(data?.active_users ?? '—')} />
        <Metric title="Today traffic" value={data ? formatBytes(data.today_traffic) : '—'} />
        <Metric title="Xray" value={data?.xray_status ?? '—'} />
        <Metric title="Hysteria" value={data?.hysteria_status ?? '—'} />
      </div>
      <div className="grid gap-6 px-6 pb-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <div className="mb-4 text-sm text-slate-300">Traffic, last 7 days</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={traffic.data ?? []}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="recorded_at" tickFormatter={(value) => new Date(value).toLocaleDateString()} />
                <YAxis tickFormatter={(value) => formatBytes(Number(value))} />
                <Tooltip formatter={(value) => formatBytes(Number(value))} />
                <Area type="monotone" dataKey="downlink" stackId="1" stroke="#22d3ee" fill="#22d3ee33" />
                <Area type="monotone" dataKey="uplink" stackId="1" stroke="#38bdf8" fill="#38bdf833" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="mb-4 text-sm text-slate-300">Online now</div>
          <div className="space-y-3">
            {data?.online_users?.map((entry) => (
              <div key={`${entry.username}-${entry.recorded_at}`} className="flex items-center justify-between border-b border-white/5 pb-3 text-sm">
                <div>
                  <div className="font-medium text-white">{entry.username}</div>
                  <div className="text-slate-500">{new Date(entry.recorded_at).toLocaleString()}</div>
                </div>
                <div className="text-slate-300">{formatBytes(entry.bytes)}</div>
              </div>
            ))}
            {!data?.online_users?.length && <div className="text-sm text-slate-500">No recent active sessions.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-400">{title}</div>
      <div className="mt-4 text-3xl font-semibold">{value}</div>
    </Card>
  );
}

