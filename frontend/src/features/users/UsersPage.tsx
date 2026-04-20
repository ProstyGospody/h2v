import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, ApiError } from '@/shared/api/client';
import { TrafficPoint, User, UserLinks, UserStatus } from '@/shared/api/types';
import {
  Button,
  Card,
  CardContent,
  DetailStat,
  DurationBadge,
  EmptyState,
  Label,
  MonoField,
  PageHeader,
  SecondaryButton,
  Skeleton,
  StatusBadge,
  Textarea,
  TrafficBar,
  Input,
} from '@/shared/ui/primitives';
import { formatBytes, formatDate, formatDateTime, relativeExpiry } from '@/shared/lib/format';

const statusOptions: Array<{ label: string; value: 'all' | UserStatus }> = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Limited', value: 'limited' },
  { label: 'Expired', value: 'expired' },
  { label: 'Disabled', value: 'disabled' },
];

export function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'all' | UserStatus>('all');
  const [nearExpiry, setNearExpiry] = useState(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users', search, status, nearExpiry],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status !== 'all') params.set('status', status);
      if (nearExpiry) params.set('near_expiry', '14');
      params.set('per_page', '100');
      const query = params.toString();
      return apiClient.request<User[]>(`/users${query ? `?${query}` : ''}`);
    },
  });

  const activeUser = useMemo(() => users.data?.find((item) => item.id === activeUserId) ?? null, [activeUserId, users.data]);
  const selectedUsers = useMemo(
    () => users.data?.filter((item) => selectedIds.includes(item.id)) ?? [],
    [selectedIds, users.data],
  );

  useEffect(() => {
    if (!users.data?.length) {
      setActiveUserId(null);
      setSelectedIds([]);
      return;
    }

    setSelectedIds((current) => current.filter((id) => users.data?.some((user) => user.id === id)));

    if (!activeUserId || !users.data.some((user) => user.id === activeUserId)) {
      setActiveUserId(users.data[0].id);
    }
  }, [activeUserId, users.data]);

  const links = useQuery({
    enabled: Boolean(activeUserId),
    queryKey: ['users', activeUserId, 'links'],
    queryFn: () => apiClient.request<UserLinks>(`/users/${activeUserId}/links`),
  });

  const traffic = useQuery({
    enabled: Boolean(activeUserId),
    queryKey: ['users', activeUserId, 'traffic'],
    queryFn: () => apiClient.request<TrafficPoint[]>(`/users/${activeUserId}/traffic?days=7`),
  });

  async function refreshUsers() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: ['stats', 'overview'] }),
    ]);
  }

  async function runBulkAction(label: string, action: (id: string) => Promise<unknown>) {
    if (!selectedIds.length) return;
    setBusyAction(label);
    try {
      for (const id of selectedIds) {
        await action(id);
      }
      toast.success(`${label} complete`);
      setSelectedIds([]);
      await refreshUsers();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  const allSelected = Boolean(users.data?.length) && selectedIds.length === users.data?.length;
  const bulkStatusLabel = selectedUsers.every((user) => user.status === 'disabled') ? 'Enable' : 'Disable';

  return (
    <div className="pb-8">
      <PageHeader
        title={`Users (${users.data?.length ?? 0})`}
        subtitle="Search, filter, and manage subscription state without leaving the table."
        action={
          <Button leadingIcon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)} type="button">
            Create user
          </Button>
        }
      />

      <div className="space-y-6 px-5 pt-5 sm:px-6">
        <Card>
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="relative w-full md:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search by username" value={search} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  className={
                    option.value === status
                      ? 'rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-foreground'
                      : 'rounded-md border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-muted-foreground'
                  }
                  onClick={() => setStatus(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
              <button
                className={
                  nearExpiry
                    ? 'rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs font-medium text-warning'
                    : 'rounded-md border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-muted-foreground'
                }
                onClick={() => setNearExpiry((current) => !current)}
                type="button"
              >
                Near expiry
              </button>
            </div>
          </CardContent>
        </Card>

        {selectedIds.length ? (
          <Card>
            <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-foreground">{selectedIds.length} selected</div>
              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton
                  busy={busyAction === 'status'}
                  onClick={() =>
                    runBulkAction('status', (id) =>
                      apiClient.request(`/users/${id}`, {
                        body: JSON.stringify({ status: bulkStatusLabel === 'Disable' ? 'disabled' : 'active' }),
                        method: 'PATCH',
                      }),
                    )
                  }
                  type="button"
                >
                  {bulkStatusLabel}
                </SecondaryButton>
                <SecondaryButton
                  busy={busyAction === 'extend'}
                  onClick={() =>
                    runBulkAction('extend', async (id) => {
                      const user = users.data?.find((item) => item.id === id);
                      const baseDate = user?.expires_at ? new Date(user.expires_at) : new Date();
                      const nextDate = addDays(baseDate > new Date() ? baseDate : new Date(), 30);
                      return apiClient.request(`/users/${id}`, {
                        body: JSON.stringify({ expires_at: nextDate.toISOString() }),
                        method: 'PATCH',
                      });
                    })
                  }
                  type="button"
                >
                  Extend +30d
                </SecondaryButton>
                <SecondaryButton
                  busy={busyAction === 'traffic'}
                  onClick={() => runBulkAction('traffic', (id) => apiClient.request(`/users/${id}/reset-traffic`, { method: 'POST' }))}
                  type="button"
                >
                  Reset traffic
                </SecondaryButton>
                <Button
                  busy={busyAction === 'delete'}
                  leadingIcon={<Trash2 className="size-4" />}
                  onClick={() => runBulkAction('delete', (id) => apiClient.request(`/users/${id}`, { method: 'DELETE' }))}
                  type="button"
                  variant="destructive"
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              {users.isLoading ? (
                <div className="space-y-3 p-6">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 w-full" />
                  ))}
                </div>
              ) : users.data?.length ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-surface-elevated text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">
                        <input
                          checked={allSelected}
                          onChange={() => {
                            if (allSelected) {
                              setSelectedIds([]);
                            } else {
                              setSelectedIds(users.data?.map((user) => user.id) ?? []);
                            }
                          }}
                          type="checkbox"
                        />
                      </th>
                      <th className="px-4 py-3 font-medium">Username</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Traffic</th>
                      <th className="hidden px-4 py-3 font-medium md:table-cell">Expires</th>
                      <th className="hidden px-4 py-3 font-medium lg:table-cell">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.data.map((user) => {
                      const checked = selectedIds.includes(user.id);
                      return (
                        <tr
                          key={user.id}
                          className={user.id === activeUserId ? 'cursor-pointer border-t border-border bg-primary/6' : 'cursor-pointer border-t border-border hover:bg-[hsl(var(--hover-overlay))]'}
                          onClick={() => setActiveUserId(user.id)}
                        >
                          <td className="px-4 py-4" onClick={(event) => event.stopPropagation()}>
                            <input
                              checked={checked}
                              onChange={() =>
                                setSelectedIds((current) =>
                                  checked ? current.filter((id) => id !== user.id) : [...current, user.id],
                                )
                              }
                              type="checkbox"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-foreground">{user.username}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{user.note || 'No note'}</div>
                          </td>
                          <td className="px-4 py-4">
                            <StatusBadge status={user.status} />
                          </td>
                          <td className="min-w-52 px-4 py-4">
                            <TrafficBar total={user.traffic_limit} used={user.traffic_used} />
                          </td>
                          <td className="hidden px-4 py-4 md:table-cell">
                            <div className="space-y-2">
                              <DurationBadge value={user.expires_at} />
                              <div className="text-xs text-muted-foreground">{relativeExpiry(user.expires_at)}</div>
                            </div>
                          </td>
                          <td className="hidden px-4 py-4 text-muted-foreground lg:table-cell">{formatDate(user.created_at, 'MMM d')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-6">
                  <EmptyState
                    action={
                      <Button leadingIcon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)} type="button">
                        Create user
                      </Button>
                    }
                    description="Create the first user to generate subscription links and start collecting traffic."
                    title="No users yet"
                  />
                </div>
              )}
            </div>
          </Card>

          <Card className="h-fit">
            <CardContent className="space-y-6">
              {activeUser ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="t-h2">{activeUser.username}</div>
                      <StatusBadge status={activeUser.status} />
                    </div>
                    <div className="text-sm text-muted-foreground">{activeUser.note || 'No note on this subscription.'}</div>
                  </div>

                  <TrafficBar animated total={activeUser.traffic_limit} used={activeUser.traffic_used} />

                  <div className="space-y-1">
                    <DetailStat label="Created" value={formatDateTime(activeUser.created_at)} />
                    <DetailStat label="Expires" value={activeUser.expires_at ? formatDateTime(activeUser.expires_at) : 'Never'} />
                    <DetailStat label="Status" value={<StatusBadge status={activeUser.status} />} />
                  </div>

                  <div className="grid gap-2">
                    <SecondaryButton
                      busy={busyAction === 'single-sub'}
                      onClick={async () => {
                        setBusyAction('single-sub');
                        try {
                          await apiClient.request(`/users/${activeUser.id}/reset-sub`, { method: 'POST' });
                          toast.success('Subscription link rotated');
                          await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ['users', activeUser.id, 'links'] }),
                            queryClient.invalidateQueries({ queryKey: ['users'] }),
                          ]);
                        } catch (error) {
                          toast.error(error instanceof ApiError ? error.message : 'Unable to rotate link');
                        } finally {
                          setBusyAction(null);
                        }
                      }}
                      type="button"
                    >
                      Reset link
                    </SecondaryButton>
                    <SecondaryButton
                      busy={busyAction === 'single-traffic'}
                      onClick={async () => {
                        setBusyAction('single-traffic');
                        try {
                          await apiClient.request(`/users/${activeUser.id}/reset-traffic`, { method: 'POST' });
                          toast.success('Traffic counters reset');
                          await refreshUsers();
                        } catch (error) {
                          toast.error(error instanceof ApiError ? error.message : 'Unable to reset traffic');
                        } finally {
                          setBusyAction(null);
                        }
                      }}
                      type="button"
                    >
                      Reset traffic
                    </SecondaryButton>
                  </div>

                  <div className="space-y-3">
                    <div className="t-label">Subscription links</div>
                    {links.isLoading ? (
                      <>
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                      </>
                    ) : links.data ? (
                      <>
                        <MonoField label="Subscription" value={links.data.subscription} />
                        <MonoField label="VLESS" value={links.data.vless} />
                        <MonoField label="Hysteria 2" value={links.data.hysteria2} />
                        <div className="grid gap-3 sm:grid-cols-3">
                          <QrThumb image={links.data.qr.subscription} label="Subscription" />
                          <QrThumb image={links.data.qr.vless} label="VLESS" />
                          <QrThumb image={links.data.qr.hysteria2} label="Hysteria 2" />
                        </div>
                      </>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    <div className="t-label">Traffic history</div>
                    <div className="h-36 rounded-md border border-border bg-surface-elevated p-3">
                      {traffic.isLoading ? (
                        <Skeleton className="h-full w-full" />
                      ) : traffic.data?.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={traffic.data}>
                            <defs>
                              <linearGradient id="userTraffic" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--surface))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                              }}
                              formatter={(value) => [formatBytes(Number(value)), 'Traffic']}
                              labelFormatter={(value) => formatDate(value, 'MMM d')}
                            />
                            <Area
                              dataKey={(point: TrafficPoint) => point.downlink + point.uplink}
                              fill="url(#userTraffic)"
                              stroke="hsl(var(--primary))"
                              strokeWidth={2}
                              type="monotone"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No traffic samples yet.</div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState description="Pick a user row to inspect usage, links, and recent traffic." title="Select a user" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {createOpen ? (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await refreshUsers();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [username, setUsername] = useState(generateUsername());
  const [trafficGb, setTrafficGb] = useState<number | null>(50);
  const [expiryDays, setExpiryDays] = useState<number | null>(30);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const trafficPresets = [10, 50, 100, 500];
  const expiryPresets = [7, 30, 90, 365];

  async function submit() {
    setBusy(true);
    try {
      await apiClient.request('/users', {
        body: JSON.stringify({
          expires_at: expiryDays ? addDays(new Date(), expiryDays).toISOString() : null,
          note,
          traffic_limit: trafficGb ? trafficGb * 1024 * 1024 * 1024 : 0,
          username,
        }),
        method: 'POST',
      });
      toast.success('User created');
      await onCreated();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Unable to create user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <Card className="w-full max-w-xl">
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2">
            <div className="t-h2">Create user</div>
            <p className="text-sm text-muted-foreground">Generate a new subscription with preset traffic and expiry defaults.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="flex gap-2">
              <Input id="username" onChange={(event) => setUsername(event.target.value)} value={username} />
              <SecondaryButton onClick={() => setUsername(generateUsername())} type="button">
                Regenerate
              </SecondaryButton>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Traffic limit</Label>
            <div className="flex flex-wrap gap-2">
              {trafficPresets.map((preset) => (
                <PresetChip key={preset} active={trafficGb === preset} label={`${preset} GB`} onClick={() => setTrafficGb(preset)} />
              ))}
              <PresetChip active={trafficGb === null} label="Unlimited" onClick={() => setTrafficGb(null)} />
            </div>
            <Input
              min={1}
              onChange={(event) => setTrafficGb(event.target.value ? Number(event.target.value) : null)}
              placeholder="Custom GB"
              type="number"
              value={trafficGb ?? ''}
            />
          </div>

          <div className="space-y-3">
            <Label>Expires in</Label>
            <div className="flex flex-wrap gap-2">
              {expiryPresets.map((preset) => (
                <PresetChip key={preset} active={expiryDays === preset} label={`${preset} days`} onClick={() => setExpiryDays(preset)} />
              ))}
              <PresetChip active={expiryDays === null} label="Never" onClick={() => setExpiryDays(null)} />
            </div>
            <Input
              min={1}
              onChange={(event) => setExpiryDays(event.target.value ? Number(event.target.value) : null)}
              placeholder="Custom days"
              type="number"
              value={expiryDays ?? ''}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-warning/25 bg-warning/10 px-3 py-3 text-sm text-warning">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4" />
              Subscription links are generated immediately after creation.
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <SecondaryButton onClick={onClose} type="button">
              Cancel
            </SecondaryButton>
            <Button busy={busy} leadingIcon={<Plus className="size-4" />} onClick={() => void submit()} type="button">
              Create user
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PresetChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={
        active
          ? 'rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-foreground'
          : 'rounded-md border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-muted-foreground'
      }
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function QrThumb({ image, label }: { image: string; label: string }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface-elevated p-3">
      <div className="t-label">{label}</div>
      <img alt={label} className="w-full rounded-sm bg-white" src={image} />
    </div>
  );
}

function generateUsername() {
  return `user_${Math.random().toString(36).slice(2, 8)}`;
}
