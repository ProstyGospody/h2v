import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import {
  AlertTriangle,
  ArrowRight,
  Copy,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, ApiError } from '@/shared/api/client';
import { TrafficPoint, User, UserLinks, UserStatus } from '@/shared/api/types';
import { daysUntil, formatBytes, formatDate, formatDateTime, relativeExpiry, usagePercent } from '@/shared/lib/format';

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
  const [status, setStatus] = useState<'all' | UserStatus>('all');
  const [nearExpiry, setNearExpiry] = useState(false);
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const users = useQuery({
    queryKey: ['users', search, status, nearExpiry],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status !== 'all') params.set('status', status);
      if (nearExpiry) params.set('near_expiry', '14');
      params.set('per_page', '100');
      const q = params.toString();
      return apiClient.request<User[]>(`/users${q ? `?${q}` : ''}`);
    },
  });

  const drawerUser = useMemo(
    () => users.data?.find((u) => u.id === drawerUserId) ?? null,
    [drawerUserId, users.data],
  );

  const allSelected = Boolean(users.data?.length) && selectedIds.length === users.data?.length;

  async function refreshUsers() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: ['stats', 'overview'] }),
    ]);
  }

  async function runBulk(label: string, action: (id: string) => Promise<unknown>) {
    if (!selectedIds.length) return;
    setBusyAction(label);
    try {
      for (const id of selectedIds) await action(id);
      toast.success(`${label} complete`);
      setSelectedIds([]);
      await refreshUsers();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="pb-10">
      <header className="px-5 pb-2 pt-8 sm:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="flex items-baseline gap-2.5 text-[26px] font-semibold leading-none tracking-[-0.01em] text-foreground">
              <span>Users</span>
              <span className="font-mono text-base text-muted-foreground">
                {users.data?.length ?? 0}
              </span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Create user
            </Button>
          </div>
        </div>
      </header>

      <div className="space-y-4 px-5 pt-6 sm:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by username..."
              value={search}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs onValueChange={(v) => setStatus(v as typeof status)} value={status}>
              <TabsList>
                {statusOptions.map((o) => (
                  <TabsTrigger key={o.value} value={o.value}>
                    {o.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button
              onClick={() => setNearExpiry((v) => !v)}
              size="sm"
              variant={nearExpiry ? 'outline' : 'ghost'}
            >
              Near expiry
            </Button>
          </div>
        </div>

        {selectedIds.length ? (
          <div className="flex flex-col items-start justify-between gap-3 rounded-lg bg-primary/8 px-4 py-3 md:flex-row md:items-center">
            <div className="flex items-center gap-2 text-sm">
              <Badge>{selectedIds.length}</Badge>
              <span className="text-muted-foreground">selected</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busyAction === 'disable'}
                onClick={() =>
                  runBulk('disable', (id) =>
                    apiClient.request(`/users/${id}`, {
                      body: JSON.stringify({ status: 'disabled' }),
                      method: 'PATCH',
                    }),
                  )
                }
                size="sm"
                variant="secondary"
              >
                Disable
              </Button>
              <Button
                disabled={busyAction === 'extend'}
                onClick={() =>
                  runBulk('extend', async (id) => {
                    const u = users.data?.find((x) => x.id === id);
                    const base = u?.expires_at ? new Date(u.expires_at) : new Date();
                    const next = addDays(base > new Date() ? base : new Date(), 30);
                    return apiClient.request(`/users/${id}`, {
                      body: JSON.stringify({ expires_at: next.toISOString() }),
                      method: 'PATCH',
                    });
                  })
                }
                size="sm"
                variant="secondary"
              >
                +30d
              </Button>
              <Button
                disabled={busyAction === 'traffic'}
                onClick={() =>
                  runBulk('traffic', (id) =>
                    apiClient.request(`/users/${id}/reset-traffic`, { method: 'POST' }),
                  )
                }
                size="sm"
                variant="secondary"
              >
                Reset traffic
              </Button>
              <Button
                disabled={busyAction === 'delete'}
                onClick={() =>
                  runBulk('delete', (id) =>
                    apiClient.request(`/users/${id}`, { method: 'DELETE' }),
                  )
                }
                size="sm"
                variant="destructive"
              >
                <Trash2 />
                Delete
              </Button>
            </div>
          </div>
        ) : null}

        <Card className="overflow-hidden">
          {users.isLoading ? (
            <CardContent className="space-y-2 p-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          ) : users.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      checked={allSelected}
                      onChange={() => {
                        if (allSelected) setSelectedIds([]);
                        else setSelectedIds(users.data?.map((u) => u.id) ?? []);
                      }}
                      type="checkbox"
                    />
                  </TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Traffic</TableHead>
                  <TableHead className="hidden md:table-cell">Expires</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.map((user) => {
                  const checked = selectedIds.includes(user.id);
                  const trafficPercent = usagePercent(user.traffic_used, user.traffic_limit);
                  const trafficFillClass =
                    trafficPercent >= 90
                      ? 'bg-destructive'
                      : trafficPercent >= 70
                        ? 'bg-warning'
                        : 'bg-primary';
                  const expiresInDays = daysUntil(user.expires_at);
                  return (
                    <TableRow
                      className="cursor-pointer"
                      key={user.id}
                      onClick={() => setDrawerUserId(user.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <input
                          checked={checked}
                          onChange={() =>
                            setSelectedIds((curr) =>
                              checked ? curr.filter((id) => id !== user.id) : [...curr, user.id],
                            )
                          }
                          type="checkbox"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{user.username}</div>
                        {user.note ? (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.note}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {user.status === 'active' ? (
                          <Badge variant="success">
                            <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
                            Active
                          </Badge>
                        ) : user.status === 'limited' ? (
                          <Badge variant="destructive">Limited</Badge>
                        ) : user.status === 'expired' ? (
                          <Badge variant="warning">Expired</Badge>
                        ) : (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                      </TableCell>
                      <TableCell className="min-w-52">
                        <div className="space-y-1.5">
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${trafficFillClass}`}
                              style={{ width: `${trafficPercent}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="font-mono">{formatBytes(user.traffic_used)}</span>
                            <span className="font-mono">
                              {user.traffic_limit > 0 ? formatBytes(user.traffic_limit) : 'Unlimited'}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {expiresInDays === null ? (
                          <Badge variant="secondary">Never</Badge>
                        ) : expiresInDays < 0 ? (
                          <Badge variant="warning">Expired</Badge>
                        ) : expiresInDays < 3 ? (
                          <Badge variant="warning">{expiresInDays}d left</Badge>
                        ) : (
                          <Badge variant="secondary">{expiresInDays}d left</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {formatDate(user.created_at, 'MMM d')}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <UserRowMenu onReset={refreshUsers} user={user} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <div className="space-y-1">
                <div className="text-base font-semibold text-foreground">No users yet</div>
                <p className="max-w-md text-sm text-muted-foreground">
                  Create the first user to generate subscription links.
                </p>
              </div>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Create user
              </Button>
            </CardContent>
          )}
        </Card>
      </div>

      <UserDrawer onClose={() => setDrawerUserId(null)} user={drawerUser} />

      <CreateUserDialog
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await refreshUsers();
        }}
        open={createOpen}
      />
    </div>
  );
}

function UserRowMenu({ user, onReset }: { user: User; onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, message: string) {
    setBusy(key);
    try {
      await action();
      toast.success(message);
      await onReset();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Open menu" size="icon" variant="ghost">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={busy === 'status'}
          onSelect={() =>
            run(
              'status',
              () =>
                apiClient.request(`/users/${user.id}`, {
                  body: JSON.stringify({
                    status: user.status === 'disabled' ? 'active' : 'disabled',
                  }),
                  method: 'PATCH',
                }),
              user.status === 'disabled' ? 'User enabled' : 'User disabled',
            )
          }
        >
          {user.status === 'disabled' ? 'Enable' : 'Disable'}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy === 'reset-traffic'}
          onSelect={() =>
            run(
              'reset-traffic',
              () => apiClient.request(`/users/${user.id}/reset-traffic`, { method: 'POST' }),
              'Traffic reset',
            )
          }
        >
          <RotateCcw />
          Reset traffic
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy === 'reset-sub'}
          onSelect={() =>
            run(
              'reset-sub',
              () => apiClient.request(`/users/${user.id}/reset-sub`, { method: 'POST' }),
              'Subscription rotated',
            )
          }
        >
          <RefreshCw />
          Reset link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy === 'delete'}
          onSelect={() =>
            run(
              'delete',
              () => apiClient.request(`/users/${user.id}`, { method: 'DELETE' }),
              'User deleted',
            )
          }
          variant="destructive"
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserDrawer({ onClose, user }: { onClose: () => void; user: User | null }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const open = Boolean(user);
  const trafficPercent = user ? usagePercent(user.traffic_used, user.traffic_limit) : 0;
  const trafficFillClass =
    trafficPercent >= 90 ? 'bg-destructive' : trafficPercent >= 70 ? 'bg-warning' : 'bg-primary';

  const links = useQuery({
    enabled: open && Boolean(user?.id),
    queryKey: ['users', user?.id, 'links'],
    queryFn: () => apiClient.request<UserLinks>(`/users/${user!.id}/links`),
  });

  const traffic = useQuery({
    enabled: open && Boolean(user?.id),
    queryKey: ['users', user?.id, 'traffic'],
    queryFn: () => apiClient.request<TrafficPoint[]>(`/users/${user!.id}/traffic?days=7`),
  });

  async function reset() {
    if (!user) return;
    setBusy('reset-sub');
    try {
      await apiClient.request(`/users/${user.id}/reset-sub`, { method: 'POST' });
      toast.success('Subscription rotated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users', user.id, 'links'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ]);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet onOpenChange={(next) => (next ? null : onClose())} open={open}>
      <SheetContent className="overflow-y-auto" side="right">
        {user ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                {user.username}
                {user.status === 'active' ? (
                  <Badge variant="success">
                    <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
                    Active
                  </Badge>
                ) : user.status === 'limited' ? (
                  <Badge variant="destructive">Limited</Badge>
                ) : user.status === 'expired' ? (
                  <Badge variant="warning">Expired</Badge>
                ) : (
                  <Badge variant="secondary">Disabled</Badge>
                )}
              </SheetTitle>
              <SheetDescription>{user.note || 'No note attached.'}</SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-6 pb-6">
              <div className="space-y-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${trafficFillClass}`}
                    style={{ width: `${trafficPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono">{formatBytes(user.traffic_used)}</span>
                  <span className="font-mono">
                    {user.traffic_limit > 0 ? formatBytes(user.traffic_limit) : 'Unlimited'}
                  </span>
                </div>
              </div>

              <div className="divide-y">
                <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-right text-foreground">{formatDateTime(user.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">Expires</span>
                  <span className="text-right text-foreground">
                    {user.expires_at ? formatDateTime(user.expires_at) : 'Never'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="text-right text-foreground">
                    {user.status === 'active' ? (
                      <Badge variant="success">
                        <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
                        Active
                      </Badge>
                    ) : user.status === 'limited' ? (
                      <Badge variant="destructive">Limited</Badge>
                    ) : user.status === 'expired' ? (
                      <Badge variant="warning">Expired</Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </span>
                </div>
              </div>

              <Separator />

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy === 'reset-sub'} onClick={reset} size="sm" variant="secondary">
                  <RefreshCw />
                  Reset link
                </Button>
              </div>

              <div className="space-y-2">
                <div className="t-label">Links</div>
                {links.isLoading ? (
                  <>
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </>
                ) : links.data ? (
                  ([
                    { label: 'Subscription', value: links.data.subscription },
                    { label: 'VLESS', value: links.data.vless },
                    { label: 'Hysteria 2', value: links.data.hysteria2 },
                  ] as const).map((link) => (
                    <div className="rounded-md bg-muted p-3" key={link.label}>
                      <div className="mb-2 t-label">{link.label}</div>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                          {link.value || '--'}
                        </div>
                        <Button
                          onClick={async () => {
                            if (!link.value) return;
                            await navigator.clipboard.writeText(link.value);
                            toast.success(`${link.label} copied`);
                          }}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Copy className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="t-label">Traffic / 7 days</div>
                <div className="h-32 rounded-md bg-muted p-2">
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
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px',
                            fontSize: 12,
                          }}
                          formatter={(v) => [formatBytes(Number(v)), 'Traffic']}
                          labelFormatter={(v) => formatDate(v, 'MMM d')}
                        />
                        <Area
                          dataKey={(p: TrafficPoint) => p.downlink + p.uplink}
                          fill="url(#userTraffic)"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          type="monotone"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No traffic samples yet.
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{relativeExpiry(user.expires_at)}</div>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
  open,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
  open: boolean;
}) {
  const [username, setUsername] = useState(generateUsername());
  const [trafficGb, setTrafficGb] = useState<number | null>(50);
  const [expiryDays, setExpiryDays] = useState<number | null>(30);
  const [note, setNote] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.request('/users', {
        body: JSON.stringify({
          expires_at: expiryDays ? addDays(new Date(), expiryDays).toISOString() : null,
          note,
          traffic_limit: trafficGb ? trafficGb * 1024 * 1024 * 1024 : 0,
          username,
        }),
        method: 'POST',
      }),
    onSuccess: async () => {
      toast.success('User created');
      setUsername(generateUsername());
      setNote('');
      await onCreated();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to create user');
    },
  });

  const trafficPresets = [10, 50, 100, 500];
  const expiryPresets = [7, 30, 90, 365];

  return (
    <Dialog onOpenChange={(next) => (next ? null : onClose())} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>New subscription with traffic and expiry defaults.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <Input
                className="pr-10 font-mono"
                id="username"
                onChange={(e) => setUsername(e.target.value)}
                value={username}
              />
              <Button
                aria-label="Regenerate"
                className="absolute inset-y-0 right-0 h-full w-10 rounded-l-none"
                onClick={() => setUsername(generateUsername())}
                size="icon"
                type="button"
                variant="ghost"
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Traffic</Label>
            <div className="flex flex-wrap gap-1.5">
              {trafficPresets.map((p) => (
                <Button
                  className="h-7 px-3 text-xs"
                  key={p}
                  onClick={() => setTrafficGb(p)}
                  size="sm"
                  type="button"
                  variant={trafficGb === p ? 'default' : 'secondary'}
                >
                  {p} GB
                </Button>
              ))}
              <Button
                className="h-7 px-3 text-xs"
                onClick={() => setTrafficGb(null)}
                size="sm"
                type="button"
                variant={trafficGb === null ? 'default' : 'secondary'}
              >
                Unlimited
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Expires in</Label>
            <div className="flex flex-wrap gap-1.5">
              {expiryPresets.map((p) => (
                <Button
                  className="h-7 px-3 text-xs"
                  key={p}
                  onClick={() => setExpiryDays(p)}
                  size="sm"
                  type="button"
                  variant={expiryDays === p ? 'default' : 'secondary'}
                >
                  {p}d
                </Button>
              ))}
              <Button
                className="h-7 px-3 text-xs"
                onClick={() => setExpiryDays(null)}
                size="sm"
                type="button"
                variant={expiryDays === null ? 'default' : 'secondary'}
              >
                Never
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              onChange={(e) => setNote(e.target.value)}
              placeholder="Friend from Riga..."
              rows={2}
              value={note}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>Subscription links generate immediately.</span>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Create
            <ArrowRight />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function generateUsername() {
  return `user_${Math.random().toString(36).slice(2, 8)}`;
}
