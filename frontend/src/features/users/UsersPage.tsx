import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/shared/api/client';
import { TrafficPoint, User, UserLinks } from '@/shared/api/types';
import { formatBytes, relativeExpiry } from '@/shared/lib/format';
import { Badge, Button, Card, Input, PageHeader, SecondaryButton } from '@/shared/ui/primitives';

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const users = useQuery({
    queryKey: ['users', search],
    queryFn: () => apiClient.request<User[]>(`/users?search=${encodeURIComponent(search)}`),
  });

  const selectedUser = useMemo(() => users.data?.find((item) => item.id === selectedId) ?? null, [users.data, selectedId]);

  const links = useQuery({
    enabled: Boolean(selectedId),
    queryKey: ['users', selectedId, 'links'],
    queryFn: () => apiClient.request<UserLinks>(`/users/${selectedId}/links`),
  });

  const traffic = useQuery({
    enabled: Boolean(selectedId),
    queryKey: ['users', selectedId, 'traffic'],
    queryFn: () => apiClient.request<TrafficPoint[]>(`/users/${selectedId}/traffic?days=7`),
  });

  const createUser = useMutation({
    mutationFn: () =>
      apiClient.request('/users', {
        method: 'POST',
        body: JSON.stringify({ username: '', traffic_limit: 50 * 1024 * 1024 * 1024, note: '' }),
      }),
    onSuccess: async () => {
      toast.success('User created');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Search, create, and inspect individual subscriptions."
        action={
          <div className="flex gap-2">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search username" className="w-64" />
            <Button onClick={() => createUser.mutate()}>Create user</Button>
          </div>
        }
      />
      <div className="grid gap-6 p-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-slate-400">
              <tr>
                <th className="px-3 py-3 font-medium">User</th>
                <th className="px-3 py-3 font-medium">Usage</th>
                <th className="px-3 py-3 font-medium">Expiry</th>
                <th className="px-3 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((user) => (
                <tr
                  key={user.id}
                  className="cursor-pointer border-b border-white/5 hover:bg-white/5"
                  onClick={() => setSelectedId(user.id)}
                >
                  <td className="px-3 py-3">
                    <div className="font-medium text-white">{user.username}</div>
                    <div className="text-xs text-slate-500">{new Date(user.created_at).toLocaleDateString()}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-300">
                    {formatBytes(user.traffic_used)} / {user.traffic_limit ? formatBytes(user.traffic_limit) : 'Unlimited'}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{relativeExpiry(user.expires_at)}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          {selectedUser ? (
            <div className="space-y-5">
              <div>
                <div className="text-lg font-semibold">{selectedUser.username}</div>
                <div className="mt-1 text-sm text-slate-500">{selectedUser.note || 'No note'}</div>
              </div>
              <div className="grid gap-3">
                <MetricLine label="Used" value={formatBytes(selectedUser.traffic_used)} />
                <MetricLine label="Limit" value={selectedUser.traffic_limit ? formatBytes(selectedUser.traffic_limit) : 'Unlimited'} />
                <MetricLine label="Expires" value={relativeExpiry(selectedUser.expires_at)} />
              </div>
              <div className="grid gap-2">
                <SecondaryButton onClick={() => navigator.clipboard.writeText(links.data?.subscription ?? '')}>Copy subscription</SecondaryButton>
                <SecondaryButton onClick={() => navigator.clipboard.writeText(links.data?.vless ?? '')}>Copy VLESS</SecondaryButton>
                <SecondaryButton onClick={() => navigator.clipboard.writeText(links.data?.hysteria2 ?? '')}>Copy Hysteria 2</SecondaryButton>
              </div>
              {links.data && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <img alt="Subscription QR" src={links.data.qr.subscription} className="w-full border border-white/10 bg-white" />
                  <img alt="VLESS QR" src={links.data.qr.vless} className="w-full border border-white/10 bg-white" />
                  <img alt="Hysteria QR" src={links.data.qr.hysteria2} className="w-full border border-white/10 bg-white" />
                </div>
              )}
              <div className="text-xs text-slate-500">Traffic points: {traffic.data?.length ?? 0}</div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Select a user to view links and usage.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'active' ? 'success' : status === 'disabled' ? 'danger' : 'warning';
  return <Badge tone={tone}>{status}</Badge>;
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-white">{value}</span>
    </div>
  );
}

