import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { QRCodeSVG } from 'qrcode.react';
import { Bar, BarChart } from 'recharts';
import {
  ArrowRight,
  Copy,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
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
import { daysUntil, formatBytes, formatDate, formatDateTime, usagePercent } from '@/shared/lib/format';

const statusOptions: Array<{ label: string; value: 'all' | UserStatus }> = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Limited', value: 'limited' },
  { label: 'Expired', value: 'expired' },
  { label: 'Disabled', value: 'disabled' },
];

const userTrafficChartConfig = {
  total: {
    label: 'Traffic',
    color: 'hsl(var(--primary))',
  },
} satisfies ChartConfig;

export function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | UserStatus>('all');
  const [nearExpiry, setNearExpiry] = useState(false);
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [qrUserId, setQrUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rowAction, setRowAction] = useState<{ key: string; userId: string } | null>(null);
  const [drawerBusy, setDrawerBusy] = useState<string | null>(null);
  const [username, setUsername] = useState(generateUsername());
  const [trafficGb, setTrafficGb] = useState<number | null>(50);
  const [expiryDays, setExpiryDays] = useState<number | null>(30);
  const [note, setNote] = useState('');
  const trafficPresets = [10, 50, 100, 500];
  const expiryPresets = [7, 30, 90, 365];

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
    refetchInterval: 10_000,
  });

  const drawerUser = useMemo(
    () => users.data?.find((u) => u.id === drawerUserId) ?? null,
    [drawerUserId, users.data],
  );
  const qrUser = useMemo(
    () => users.data?.find((u) => u.id === qrUserId) ?? null,
    [qrUserId, users.data],
  );
  const drawerOpen = Boolean(drawerUser);
  const qrOpen = Boolean(qrUser);

  const links = useQuery({
    enabled: drawerOpen && Boolean(drawerUser?.id),
    queryKey: ['users', drawerUser?.id, 'links'],
    queryFn: () => apiClient.request<UserLinks>(`/users/${drawerUser!.id}/links`),
  });

  const qrLinks = useQuery({
    enabled: qrOpen && Boolean(qrUser?.id),
    queryKey: ['users', qrUser?.id, 'links'],
    queryFn: () => apiClient.request<UserLinks>(`/users/${qrUser!.id}/links`),
  });

  const traffic = useQuery({
    enabled: drawerOpen && Boolean(drawerUser?.id),
    queryKey: ['users', drawerUser?.id, 'traffic'],
    queryFn: () => apiClient.request<TrafficPoint[]>(`/users/${drawerUser!.id}/traffic?days=7`),
    refetchInterval: 10_000,
  });

  const allSelected = Boolean(users.data?.length) && selectedIds.length === users.data?.length;
  const drawerTrafficPercent = drawerUser
    ? usagePercent(drawerUser.traffic_used, drawerUser.traffic_limit)
    : 0;
  const drawerTrafficFillClass =
    drawerTrafficPercent >= 90
      ? 'bg-destructive'
      : drawerTrafficPercent >= 70
        ? 'bg-warning'
        : 'bg-primary';

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

  async function runRowUserAction(
    user: User,
    key: string,
    action: () => Promise<unknown>,
    message: string,
  ) {
    setRowAction({ key, userId: user.id });
    try {
      await action();
      toast.success(message);
      await refreshUsers();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Action failed');
    } finally {
      setRowAction(null);
    }
  }

  async function resetDrawerSubscription() {
    if (!drawerUser) return;
    setDrawerBusy('reset-sub');
    try {
      await apiClient.request(`/users/${drawerUser.id}/reset-sub`, { method: 'POST' });
      toast.success('Subscription rotated');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users', drawerUser.id, 'links'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ]);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Action failed');
    } finally {
      setDrawerBusy(null);
    }
  }

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
      setCreateOpen(false);
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to create user');
    },
  });

  return (
    <div className="pb-10">
      <PageHeader
        title="Users"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Create user
          </Button>
        }
      />

      <div className="space-y-4 px-page pt-6">
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
          <div className="flex flex-col items-start justify-between gap-3 rounded-md bg-primary/10 px-4 py-3 shadow-sm md:flex-row md:items-center">
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
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <input
                      aria-label="Select all"
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
                  <TableHead className="w-20">QR</TableHead>
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
                  const rowBusy = rowAction?.userId === user.id ? rowAction.key : null;
                  return (
                    <TableRow
                      className="cursor-pointer"
                      key={user.id}
                      onClick={() => setDrawerUserId(user.id)}
                    >
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          aria-label={`Select ${user.username}`}
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
                        <Button
                          onClick={() => setQrUserId(user.id)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          <QrCode />
                          QR
                        </Button>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button aria-label="Open menu" size="icon" variant="ghost">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={rowBusy === 'status'}
                              onSelect={() =>
                                void runRowUserAction(
                                  user,
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
                              disabled={rowBusy === 'reset-traffic'}
                              onSelect={() =>
                                void runRowUserAction(
                                  user,
                                  'reset-traffic',
                                  () =>
                                    apiClient.request(`/users/${user.id}/reset-traffic`, {
                                      method: 'POST',
                                    }),
                                  'Traffic reset',
                                )
                              }
                            >
                              <RotateCcw />
                              Reset traffic
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={rowBusy === 'reset-sub'}
                              onSelect={() =>
                                void runRowUserAction(
                                  user,
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
                              disabled={rowBusy === 'delete'}
                              onSelect={() =>
                                void runRowUserAction(
                                  user,
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

      <Sheet onOpenChange={(next) => (next ? null : setDrawerUserId(null))} open={drawerOpen}>
        <SheetContent className="overflow-y-auto" side="right">
          {drawerUser ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  {drawerUser.username}
                  {drawerUser.status === 'active' ? (
                    <Badge variant="success">
                      <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
                      Active
                    </Badge>
                  ) : drawerUser.status === 'limited' ? (
                    <Badge variant="destructive">Limited</Badge>
                  ) : drawerUser.status === 'expired' ? (
                    <Badge variant="warning">Expired</Badge>
                  ) : (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </SheetTitle>
                <SheetDescription>{drawerUser.note || 'No note attached.'}</SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-6 pb-6">
                <div className="space-y-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${drawerTrafficFillClass}`}
                      style={{ width: `${drawerTrafficPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">{formatBytes(drawerUser.traffic_used)}</span>
                    <span className="font-mono">
                      {drawerUser.traffic_limit > 0 ? formatBytes(drawerUser.traffic_limit) : 'Unlimited'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-2.5 text-sm">
                    <span className="text-muted-foreground">Created</span>
                    <span className="text-right text-foreground">{formatDateTime(drawerUser.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-2.5 text-sm">
                    <span className="text-muted-foreground">Expires</span>
                    <span className="text-right text-foreground">
                      {drawerUser.expires_at ? formatDateTime(drawerUser.expires_at) : 'Never'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-2.5 text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className="text-right text-foreground">
                      {drawerUser.status === 'active' ? (
                        <Badge variant="success">
                          <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
                          Active
                        </Badge>
                      ) : drawerUser.status === 'limited' ? (
                        <Badge variant="destructive">Limited</Badge>
                      ) : drawerUser.status === 'expired' ? (
                        <Badge variant="warning">Expired</Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setQrUserId(drawerUser.id)} size="sm" variant="secondary">
                    <QrCode />
                    Show QR
                  </Button>
                  <Button
                    disabled={drawerBusy === 'reset-sub'}
                    onClick={() => void resetDrawerSubscription()}
                    size="sm"
                    variant="secondary"
                  >
                    <RefreshCw />
                    Reset link
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="t-label">Connection</div>
                  {links.isLoading ? (
                    <>
                      <Skeleton className="h-11 w-full" />
                      <Skeleton className="h-11 w-full" />
                      <Skeleton className="h-11 w-full" />
                    </>
                  ) : links.data ? (
                    <div className="space-y-1.5">
                      <LinkCopyRow label="Subscription" value={links.data.subscription} />
                      <LinkCopyRow label="VLESS" value={links.data.vless} />
                      <LinkCopyRow label="Hys2" value={links.data.hysteria2} />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="t-label">Traffic / 7 days</div>
                  <div className="h-32 rounded-md bg-muted/60 p-2">
                    {traffic.isLoading ? (
                      <Skeleton className="h-full w-full" />
                    ) : traffic.data?.length ? (
                      <ChartContainer
                        className="h-full w-full aspect-auto"
                        config={userTrafficChartConfig}
                      >
                        <BarChart data={traffic.data.map((p) => ({ ...p, total: p.uplink + p.downlink }))}>
                          <ChartTooltip
                            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.3 }}
                            content={
                              <ChartTooltipContent
                                formatter={(v) => [formatBytes(Number(v)), 'Traffic']}
                                labelFormatter={(v) => formatDate(String(v), 'MMM d')}
                              />
                            }
                          />
                          <Bar dataKey="total" fill="var(--color-total)" name="total" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        No traffic samples yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={(next) => {
          if (!next) setQrUserId(null);
        }}
        open={qrOpen}
      >
        <DialogContent className="min-w-0 w-[calc(100vw-32px)] max-w-105 overflow-hidden p-0 sm:max-w-105">
          <QRDialogContent
            isLoading={qrLinks.isLoading}
            links={qrLinks.data ?? null}
            username={qrUser?.username ?? ''}
          />
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
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
          </div>

          <DialogFooter>
            <Button onClick={() => setCreateOpen(false)} variant="secondary">
              Cancel
            </Button>
            <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create
              <ArrowRight />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function generateUsername() {
  return `user_${Math.random().toString(36).slice(2, 8)}`;
}

function QRDialogContent({
  isLoading,
  links,
  username,
}: {
  isLoading: boolean;
  links: UserLinks | null;
  username: string;
}) {
  return (
    <div className="min-w-0 space-y-5 overflow-hidden p-6">
      <DialogHeader className="pr-8">
        <DialogTitle>{username || 'User'} QR</DialogTitle>
      </DialogHeader>

      {isLoading ? (
        <div className="min-w-0 space-y-4">
          <Skeleton className="mx-auto aspect-square w-full max-w-[260px] rounded-md" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : links ? (
        <div className="space-y-4">
          <div className="mx-auto w-full max-w-[260px]">
            <QRCodePreview label={`${username || 'User'} subscription QR`} value={links.subscription} />
          </div>

          <Button
            className="w-full"
            disabled={!links.subscription}
            onClick={async () => {
              if (!links.subscription) return;
              await navigator.clipboard.writeText(links.subscription);
              toast.success('Subscription copied');
            }}
            type="button"
          >
            <Copy className="size-4" />
            Copy subscription
          </Button>

          <div className="min-w-0 space-y-1.5">
            <LinkCopyRow label="VLESS" value={links.vless} />
            <LinkCopyRow label="Hys2" value={links.hysteria2} />
          </div>
        </div>
      ) : (
        <div className="rounded-md bg-destructive/10 px-3 py-6 text-center text-sm text-destructive">
          Unable to load QR data.
        </div>
      )}
    </div>
  );
}

function QRCodePreview({ label, value }: { label: string; value: string }) {
  if (!value) {
    return <div className="aspect-square w-full rounded-md border border-border/65 bg-surface" />;
  }

  return (
    <div
      aria-label={label}
      className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border/65 bg-white p-3"
      role="img"
    >
      <QRCodeSVG
        className="block h-full w-full"
        bgColor="#ffffff"
        fgColor="#050505"
        level="L"
        marginSize={4}
        size={160}
        style={{ height: '100%', width: '100%' }}
        title={label}
        value={value}
      />
    </div>
  );
}

function LinkCopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md bg-muted/60 px-3 py-2 transition-colors hover:bg-muted">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{value || '--'}</div>
      </div>
      <Button
        aria-label={`Copy ${label}`}
        className="shrink-0"
        disabled={!value}
        onClick={async () => {
          if (!value) return;
          await navigator.clipboard.writeText(value);
          toast.success(`${label} copied`);
        }}
        size="icon"
        type="button"
        variant="secondary"
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}
