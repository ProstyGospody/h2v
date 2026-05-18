import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { Bar, BarChart, XAxis } from 'recharts';
import {
  ArrowRight,
  Ban,
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Power,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
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
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/shared/api/client';
import { ListMeta, TrafficPoint, User, UserLinks, UserStatus } from '@/shared/api/types';
import { useI18n, type Locale, type Translate } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';
import { daysUntil, formatBytes, formatDate, formatDateTime, formatMonthDay, usagePercent } from '@/shared/lib/format';

type UserFilter = 'all' | UserStatus | 'near_expiry';

const statusOptions: Array<{ labelKey: TranslationKey; value: UserFilter }> = [
  { labelKey: 'users.all', value: 'all' },
  { labelKey: 'users.active', value: 'active' },
  { labelKey: 'common.expired', value: 'expired' },
  { labelKey: 'common.disabled', value: 'disabled' },
  { labelKey: 'users.nearExpiry', value: 'near_expiry' },
];

const createUserFieldClassName =
  'bg-accent-gradient-soft hover:bg-[image:var(--gradient-accent-soft)] focus-visible:bg-[image:var(--gradient-accent-soft)]';
const createUserChoiceClassName =
  'bg-accent-gradient-soft shadow-none hover:bg-[image:var(--gradient-accent-soft)]';
const trafficPresets = [10, 50, 100, 500];
const expiryPresets = [7, 30, 90, 365];
const usersPerPage = 100;
const userSearchDebounceMs = 250;
const usersRefetchIntervalMs = 30_000;
const QRCodeSVG = lazy(() => import('qrcode.react').then((module) => ({ default: module.QRCodeSVG })));

export function UsersPage() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | UserStatus>('all');
  const [nearExpiry, setNearExpiry] = useState(false);
  const [page, setPage] = useState(1);
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [qrUserId, setQrUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [rowAction, setRowAction] = useState<{ key: string; userId: string } | null>(null);
  const [drawerBusy, setDrawerBusy] = useState<string | null>(null);
  const [username, setUsername] = useState(generateUsername());
  const [trafficGb, setTrafficGb] = useState<number | null>(50);
  const [expiryDays, setExpiryDays] = useState<number | null>(30);
  const [note, setNote] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), userSearchDebounceMs);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set<string>());
  }, [debouncedSearch, status, nearExpiry]);

  useEffect(() => {
    setSelectedIds(new Set<string>());
  }, [page]);

  const users = useQuery({
    gcTime: 60_000,
    placeholderData: keepPreviousData,
    queryKey: ['users', debouncedSearch, status, nearExpiry, page, usersPerPage],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (status !== 'all') params.set('status', status);
      if (nearExpiry) params.set('near_expiry', '14');
      params.set('page', String(page));
      params.set('per_page', String(usersPerPage));
      const q = params.toString();
      return apiClient.requestEnvelope<User[], ListMeta>(`/users${q ? `?${q}` : ''}`);
    },
    refetchInterval: createOpen || Boolean(qrUserId) ? false : usersRefetchIntervalMs,
  });
  const userItems = users.data?.data ?? [];
  const userMeta = users.data?.meta;
  const activeFilter: UserFilter = nearExpiry ? 'near_expiry' : status;

  const drawerUser = useMemo(
    () => userItems.find((u) => u.id === drawerUserId) ?? null,
    [drawerUserId, userItems],
  );
  const qrUser = useMemo(
    () => userItems.find((u) => u.id === qrUserId) ?? null,
    [qrUserId, userItems],
  );
  const drawerOpen = Boolean(drawerUser);
  const qrOpen = Boolean(qrUser);

  const links = useQuery({
    gcTime: 60_000,
    enabled: drawerOpen && Boolean(drawerUser?.id),
    queryKey: ['users', drawerUser?.id, 'links'],
    queryFn: () => apiClient.request<UserLinks>(`/users/${drawerUser!.id}/links`),
  });

  const qrLinks = useQuery({
    gcTime: 60_000,
    enabled: qrOpen && Boolean(qrUser?.id),
    queryKey: ['users', qrUser?.id, 'links'],
    queryFn: () => apiClient.request<UserLinks>(`/users/${qrUser!.id}/links`),
  });

  const traffic = useQuery({
    gcTime: 60_000,
    enabled: drawerOpen && Boolean(drawerUser?.id),
    queryKey: ['users', drawerUser?.id, 'traffic'],
    queryFn: () => apiClient.request<TrafficPoint[]>(`/users/${drawerUser!.id}/traffic?days=7`),
    refetchInterval: 10_000,
  });
  const drawerTrafficData = useMemo(
    () => (traffic.data ?? []).map((p) => ({ ...p, total: p.uplink + p.downlink })),
    [traffic.data],
  );
  const hasDrawerTrafficSamples = drawerTrafficData.some((p) => p.total > 0);
  const userTrafficChartConfig = useMemo<ChartConfig>(
    () => ({
      total: {
        label: t('dashboard.traffic'),
        color: 'var(--gradient-accent)',
      },
    }),
    [t],
  );

  const selectedCount = selectedIds.size;
  const allSelected = Boolean(userItems.length) && userItems.every((user) => selectedIds.has(user.id));
  const totalUsers = userMeta?.total ?? userItems.length;
  const totalPages = Math.max(1, Math.ceil(totalUsers / usersPerPage));
  const paginationFirst = totalUsers ? (page - 1) * usersPerPage + 1 : 0;
  const paginationLast = Math.min(totalUsers, (page - 1) * usersPerPage + userItems.length);
  const showPagination = Boolean(userMeta && totalUsers > usersPerPage);
  const drawerTrafficPercent = drawerUser
    ? usagePercent(drawerUser.traffic_used, drawerUser.traffic_limit)
    : 0;
  const drawerTrafficFillClass =
    drawerTrafficPercent >= 90
      ? 'bg-destructive'
      : drawerTrafficPercent >= 70
        ? 'bg-warning'
        : 'bg-accent-gradient';

  const openUser = useCallback((id: string) => {
    setDrawerUserId(id);
  }, []);

  const showUserQR = useCallback((id: string) => {
    setQrUserId(id);
  }, []);

  const toggleUserSelection = useCallback((id: string) => {
    setSelectedIds((curr) => {
      const next = new Set(curr);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAllUsers = useCallback(() => {
    setSelectedIds((curr) => {
      if (userItems.length && userItems.every((user) => curr.has(user.id))) {
        return new Set<string>();
      }
      return new Set(userItems.map((user) => user.id));
    });
  }, [userItems]);

  const refreshUsers = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['users'] }),
      queryClient.invalidateQueries({ queryKey: ['stats', 'overview'] }),
    ]);
  }, [queryClient]);

  const runBulk = useCallback(async (key: string, label: string, body: Record<string, unknown>) => {
    if (!selectedIds.size) return;
    const ids = Array.from(selectedIds);
    setBusyAction(key);
    try {
      await apiClient.request('/users/bulk', {
        body: JSON.stringify({ ...body, ids }),
        method: 'POST',
      });
      toast.success(t('users.bulkComplete', { action: label }));
      setSelectedIds(new Set<string>());
      await refreshUsers();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('users.bulkFailed', { action: label }));
    } finally {
      setBusyAction(null);
    }
  }, [refreshUsers, selectedIds, t]);

  const runRowUserAction = useCallback(async (
    user: User,
    key: string,
    action: () => Promise<unknown>,
    message: string,
  ) => {
    setRowAction({ key, userId: user.id });
    try {
      await action();
      toast.success(message);
      await refreshUsers();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('users.actionFailed'));
    } finally {
      setRowAction(null);
    }
  }, [refreshUsers, t]);

  const resetDrawerSubscription = useCallback(async () => {
    if (!drawerUser) return;
    setDrawerBusy('reset-sub');
    try {
      await apiClient.request(`/users/${drawerUser.id}/reset-sub`, { method: 'POST' });
      toast.success(t('users.subscriptionRotated'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users', drawerUser.id, 'links'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ]);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('users.actionFailed'));
    } finally {
      setDrawerBusy(null);
    }
  }, [drawerUser, queryClient, t]);

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
      toast.success(t('users.userCreated'));
      setUsername(generateUsername());
      setNote('');
      setCreateOpen(false);
      await refreshUsers();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('users.unableCreate'));
    },
  });

  return (
    <div className="pb-10">
      <PageHeader
        action={
          <>
            <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-[22px] bg-accent-gradient-soft px-3 shadow-sm transition-colors focus-within:bg-accent-gradient-soft sm:w-72 lg:w-80 xl:w-96">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <Input
                className="h-8 border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0"
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('users.searchPlaceholder')}
                value={search}
              />
              {search ? (
                <Button
                  aria-label={t('common.reset')}
                  className="size-7 shrink-0 text-muted-foreground"
                  onClick={() => setSearch('')}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X />
                </Button>
              ) : null}
            </div>
            <div className="min-w-0 max-w-full overflow-x-auto">
              <Tabs
                onValueChange={(v) => {
                  const next = v as UserFilter;
                  if (next === 'near_expiry') {
                    setStatus('all');
                    setNearExpiry(true);
                    return;
                  }
                  setNearExpiry(false);
                  setStatus(next);
                }}
                value={activeFilter}
              >
                <TabsList className="bg-accent-gradient-soft">
                  {statusOptions.map((o) => (
                    <TabsTrigger key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              {t('users.createUser')}
            </Button>
          </>
        }
      />

      <div className="space-y-4 px-page pt-5">
        {selectedCount ? (
          <div className="flex flex-col items-start justify-between gap-3 rounded-[22px] bg-accent-gradient-soft px-4 py-3 shadow-sm md:flex-row md:items-center">
            <div className="flex items-center gap-2 text-sm">
              <Badge>{selectedCount}</Badge>
              <span className="text-muted-foreground">{t('users.selected')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busyAction === 'enable'}
                onClick={() => runBulk('enable', t('common.enable'), { action: 'enable' })}
                size="sm"
                variant="secondary"
              >
                <Power />
                {t('common.enable')}
              </Button>
              <Button
                disabled={busyAction === 'disable'}
                onClick={() => runBulk('disable', t('common.disable'), { action: 'disable' })}
                size="sm"
                variant="secondary"
              >
                <Ban />
                {t('common.disable')}
              </Button>
              <Button
                disabled={busyAction === 'extend'}
                onClick={() => runBulk('extend', '+30d', { action: 'extend', days: 30 })}
                size="sm"
                variant="secondary"
              >
                +30d
              </Button>
              <Button
                disabled={busyAction === 'traffic'}
                onClick={() => runBulk('traffic', t('users.resetTraffic'), { action: 'reset_traffic' })}
                size="sm"
                variant="secondary"
              >
                {t('users.resetTraffic')}
              </Button>
              <Button
                disabled={busyAction === 'delete'}
                onClick={() => runBulk('delete', t('common.delete'), { action: 'delete' })}
                size="sm"
                variant="destructive"
              >
                <Trash2 />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        ) : null}

        <Card className="overflow-hidden rounded-lg border-0">
          {users.isLoading ? (
            <CardContent className="space-y-2 p-5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          ) : userItems.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <input
                      aria-label={t('users.selectAll')}
                      checked={allSelected}
                      onChange={toggleAllUsers}
                      type="checkbox"
                    />
                  </TableHead>
                  <TableHead>{t('users.username')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('users.status')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('dashboard.traffic')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('users.expires')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('users.created')}</TableHead>
                  <TableHead className="hidden w-20 sm:table-cell">QR</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {userItems.map((user) => (
                  <UserTableRow
                    checked={selectedIds.has(user.id)}
                    key={user.id}
                    locale={locale}
                    onOpen={openUser}
                    onRunAction={runRowUserAction}
                    onShowQR={showUserQR}
                    onToggleSelected={toggleUserSelection}
                    rowBusy={rowAction?.userId === user.id ? rowAction.key : null}
                    t={t}
                    user={user}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <div className="space-y-1">
                <div className="text-base font-semibold text-foreground">{t('users.noUsers')}</div>
              </div>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                {t('users.createUser')}
              </Button>
            </CardContent>
          )}
        </Card>

        {showPagination ? (
          <div className="flex flex-col items-start justify-between gap-3 rounded-lg bg-surface px-3 py-3 text-sm shadow-sm sm:flex-row sm:items-center">
            <div className="font-mono text-xs text-muted-foreground">
              {t('users.paginationRange', {
                first: paginationFirst,
                last: paginationLast,
                total: totalUsers,
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={page <= 1 || users.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                size="sm"
                type="button"
                variant="secondary"
              >
                <ChevronLeft />
                {t('users.previous')}
              </Button>
              <Button
                disabled={page >= totalPages || users.isFetching}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                size="sm"
                type="button"
                variant="secondary"
              >
                {t('users.next')}
                <ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Sheet onOpenChange={(next) => (next ? null : setDrawerUserId(null))} open={drawerOpen}>
        <SheetContent className="overflow-y-auto" side="right">
          {drawerUser ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex min-w-0 flex-wrap items-center gap-2 pr-8">
                  <span className="min-w-0 truncate">{drawerUser.username}</span>
                  <UserStatusBadge status={drawerUser.status} />
                </SheetTitle>
                <SheetDescription className="break-words">{drawerUser.note || t('users.noNote')}</SheetDescription>
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
                      {drawerUser.traffic_limit > 0 ? formatBytes(drawerUser.traffic_limit) : t('common.unlimited')}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3 rounded-[22px] bg-muted/30 px-2 py-2.5 text-sm">
                    <span className="text-muted-foreground">{t('users.created')}</span>
                    <span className="text-right text-foreground">{formatDateTime(drawerUser.created_at, locale)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[22px] bg-muted/30 px-2 py-2.5 text-sm">
                    <span className="text-muted-foreground">{t('users.expires')}</span>
                    <span className="text-right text-foreground">
                      {drawerUser.expires_at ? formatDateTime(drawerUser.expires_at, locale) : t('common.never')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-[22px] bg-muted/30 px-2 py-2.5 text-sm">
                    <span className="text-muted-foreground">{t('users.status')}</span>
                    <span className="text-right text-foreground">
                      <UserStatusBadge status={drawerUser.status} />
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setQrUserId(drawerUser.id)} size="sm" variant="secondary">
                    <QrCode />
                    {t('users.showQR')}
                  </Button>
                  <Button
                    disabled={drawerBusy === 'reset-sub'}
                    onClick={() => void resetDrawerSubscription()}
                    size="sm"
                    variant="secondary"
                  >
                    <RefreshCw />
                    {t('users.resetLink')}
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="t-label">{t('users.connection')}</div>
                  {links.isLoading ? (
                    <>
                      <Skeleton className="h-11 w-full" />
                      <Skeleton className="h-11 w-full" />
                      <Skeleton className="h-11 w-full" />
                    </>
                  ) : links.data ? (
                    <div className="space-y-1.5">
                      <LinkCopyRow label={t('users.publicPage')} value={publicLink(links.data)} />
                      <LinkCopyRow label="VLESS" value={links.data.vless} />
                      <LinkCopyRow label="Hysteria 2" value={links.data.hysteria2} />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="t-label">{t('users.trafficSevenDays')}</div>
                  <div className="h-32 rounded-[22px] bg-muted/60 p-2">
                    {traffic.isLoading ? (
                      <Skeleton className="h-full w-full" />
                    ) : hasDrawerTrafficSamples ? (
                      <ChartContainer
                        className="h-full w-full aspect-auto"
                        config={userTrafficChartConfig}
                      >
                        <BarChart data={drawerTrafficData}>
                          <defs>
                            <linearGradient id="userTrafficGradient" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="var(--accent-primary)" />
                              <stop offset="100%" stopColor="var(--accent-secondary)" />
                            </linearGradient>
                          </defs>
                          <XAxis dataKey="recorded_at" hide />
                          <ChartTooltip
                            cursor={{ fill: 'url(#userTrafficGradient)', opacity: 0.18 }}
                            content={
                              <ChartTooltipContent
                                formatter={(v) => [formatBytes(Number(v)), t('dashboard.traffic')]}
                                labelFormatter={(v) => formatDate(String(v), undefined, locale)}
                              />
                            }
                          />
                          <Bar dataKey="total" fill="url(#userTrafficGradient)" name="total" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        {t('users.noTrafficSamples')}
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
        <DialogContent className="max-h-[calc(100vh-32px)] min-w-0 w-[calc(100vw-32px)] overflow-hidden p-0 sm:max-w-2xl">
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
            <DialogTitle>{t('users.createUser')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">{t('users.username')}</Label>
              <div className="relative">
                <Input
                  className={cn(createUserFieldClassName, 'pr-10 font-mono')}
                  id="username"
                  onChange={(e) => setUsername(e.target.value)}
                  value={username}
                />
                <Button
                  aria-label={t('users.regenerate')}
                  className="absolute inset-y-0 right-0 h-full w-10 rounded-l-none hover:bg-[image:var(--gradient-accent-soft)]"
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
              <Label>{t('dashboard.traffic')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {trafficPresets.map((p) => (
                  <Button
                    className={cn('h-7 px-3 text-xs', trafficGb !== p && createUserChoiceClassName)}
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
                  aria-label={t('common.unlimited')}
                  className={cn('h-7 px-3 text-xs', trafficGb !== null && createUserChoiceClassName)}
                  onClick={() => setTrafficGb(null)}
                  size="sm"
                  title={t('common.unlimited')}
                  type="button"
                  variant={trafficGb === null ? 'default' : 'secondary'}
                >
                  <span className="text-base leading-none">∞</span>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('users.expiresIn')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {expiryPresets.map((p) => (
                  <Button
                    className={cn('h-7 px-3 text-xs', expiryDays !== p && createUserChoiceClassName)}
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
                  aria-label={t('common.never')}
                  className={cn('h-7 px-3 text-xs', expiryDays !== null && createUserChoiceClassName)}
                  onClick={() => setExpiryDays(null)}
                  size="sm"
                  title={t('common.never')}
                  type="button"
                  variant={expiryDays === null ? 'default' : 'secondary'}
                >
                  <span className="text-base leading-none">∞</span>
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">{t('users.note')}</Label>
              <Textarea
                className={createUserFieldClassName}
                id="note"
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('users.friendPlaceholder')}
                rows={2}
                value={note}
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setCreateOpen(false)} variant="secondary">
              {t('common.cancel')}
            </Button>
            <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {t('users.create')}
              <ArrowRight />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type UserTableRowProps = {
  checked: boolean;
  locale: Locale;
  onOpen: (id: string) => void;
  onRunAction: (
    user: User,
    key: string,
    action: () => Promise<unknown>,
    message: string,
  ) => Promise<void>;
  onShowQR: (id: string) => void;
  onToggleSelected: (id: string) => void;
  rowBusy: string | null;
  t: Translate;
  user: User;
};

const UserTableRow = memo(function UserTableRow({
  checked,
  locale,
  onOpen,
  onRunAction,
  onShowQR,
  onToggleSelected,
  rowBusy,
  t,
  user,
}: UserTableRowProps) {
  const trafficPercent = usagePercent(user.traffic_used, user.traffic_limit);
  const trafficFillClass =
    trafficPercent >= 90
      ? 'bg-destructive'
      : trafficPercent >= 70
        ? 'bg-warning'
        : 'bg-accent-gradient';
  const expiresInDays = daysUntil(user.expires_at);

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => onOpen(user.id)}
    >
      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
        <input
          aria-label={t('users.selectUser', { username: user.username })}
          checked={checked}
          onChange={() => onToggleSelected(user.id)}
          type="checkbox"
        />
      </TableCell>
      <TableCell className="min-w-0">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{user.username}</div>
          {user.note ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{user.note}</div>
          ) : null}
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
            <UserStatusBadge status={user.status} />
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {formatBytes(user.traffic_used)} /{' '}
              {user.traffic_limit > 0 ? formatBytes(user.traffic_limit) : t('common.unlimited')}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <UserStatusBadge status={user.status} />
      </TableCell>
      <TableCell className="hidden min-w-44 sm:table-cell">
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
              {user.traffic_limit > 0 ? formatBytes(user.traffic_limit) : t('common.unlimited')}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {expiresInDays === null ? (
          <Badge variant="secondary">{t('common.never')}</Badge>
        ) : expiresInDays < 0 ? (
          <Badge variant="warning">{t('common.expired')}</Badge>
        ) : expiresInDays < 3 ? (
          <Badge variant="warning">{t('users.daysLeft', { days: expiresInDays })}</Badge>
        ) : (
          <Badge variant="secondary">{t('users.daysLeft', { days: expiresInDays })}</Badge>
        )}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
        {formatMonthDay(user.created_at, locale)}
      </TableCell>
      <TableCell className="hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
        <Button
          onClick={() => onShowQR(user.id)}
          size="sm"
          type="button"
          variant="secondary"
        >
          <QrCode />
          {t('users.qr')}
        </Button>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={t('users.tableMenu')} size="icon" variant="ghost">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={rowBusy === 'status'}
              onSelect={() =>
                void onRunAction(
                  user,
                  'status',
                  () =>
                    apiClient.request(`/users/${user.id}`, {
                      body: JSON.stringify({
                        status: user.status === 'disabled' ? 'active' : 'disabled',
                      }),
                      method: 'PATCH',
                    }),
                  user.status === 'disabled' ? t('users.userEnabled') : t('users.userDisabled'),
                )
              }
            >
              {user.status === 'disabled' ? <Power /> : <Ban />}
              {user.status === 'disabled' ? t('common.enable') : t('common.disable')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={rowBusy === 'reset-traffic'}
              onSelect={() =>
                void onRunAction(
                  user,
                  'reset-traffic',
                  () =>
                    apiClient.request(`/users/${user.id}/reset-traffic`, {
                      method: 'POST',
                    }),
                  t('users.trafficReset'),
                )
              }
            >
              <RotateCcw />
              {t('users.resetTraffic')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={rowBusy === 'reset-sub'}
              onSelect={() =>
                void onRunAction(
                  user,
                  'reset-sub',
                  () => apiClient.request(`/users/${user.id}/reset-sub`, { method: 'POST' }),
                  t('users.subscriptionRotated'),
                )
              }
            >
              <RefreshCw />
              {t('users.resetLink')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={rowBusy === 'delete'}
              onSelect={() =>
                void onRunAction(
                  user,
                  'delete',
                  () => apiClient.request(`/users/${user.id}`, { method: 'DELETE' }),
                  t('users.userDeleted'),
                )
              }
              variant="destructive"
            >
              <Trash2 />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
});

function generateUsername() {
  return `user_${Math.random().toString(36).slice(2, 8)}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function UserStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useI18n();

  if (status === 'active') {
    return (
      <Badge variant="success">
        <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
        {t('users.active')}
      </Badge>
    );
  }

  if (status === 'limited') {
    return <Badge variant="destructive">{t('users.limited')}</Badge>;
  }

  if (status === 'expired') {
    return <Badge variant="warning">{t('common.expired')}</Badge>;
  }

  return <Badge variant="secondary">{t('common.disabled')}</Badge>;
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
  const { t } = useI18n();
  const qrItems = links
    ? [
        {
          copyLabel: t('common.copy'),
          label: t('users.subscription'),
          toastLabel: t('users.subscriptionLink'),
          value: links.subscription,
        },
        {
          copyLabel: t('common.copy'),
          label: 'VLESS',
          toastLabel: 'VLESS',
          value: links.vless,
        },
        {
          copyLabel: t('common.copy'),
          label: 'Hysteria 2',
          toastLabel: 'Hysteria 2',
          value: links.hysteria2,
        },
      ]
    : [];

  return (
    <div className="min-w-0 space-y-5 overflow-y-auto p-6">
      <DialogHeader className="pr-8">
        <DialogTitle>{t('users.qrTitle', { username: username || t('common.user') })}</DialogTitle>
      </DialogHeader>

      {isLoading ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="space-y-3 rounded-[22px] bg-muted/35 p-3" key={index}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="aspect-square w-full rounded-[22px]" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : links ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {qrItems.map((item) => (
            <div className="space-y-3 rounded-[22px] bg-muted/35 p-3" key={item.label}>
              <div className="t-label">{item.label}</div>
              <QRCodePreview label={`${username || t('common.user')} ${item.label} QR`} value={item.value} />
              <Button
                className="w-full"
                disabled={!item.value}
                onClick={async () => {
                  if (!item.value) return;
                  await navigator.clipboard.writeText(item.value);
                  toast.success(t('common.copied', { label: item.toastLabel }));
                }}
                type="button"
                variant="secondary"
              >
                <Copy className="size-4" />
                {item.copyLabel}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[22px] bg-destructive/10 px-3 py-6 text-center text-sm text-destructive">
          {t('users.qrDataError')}
        </div>
      )}
    </div>
  );
}

function publicLink(links: UserLinks): string {
  return links.portal || links.subscription.replace('/sub/', '/u/');
}

function QRCodePreview({ label, value }: { label: string; value: string }) {
  if (!value) {
    return <div className="aspect-square w-full rounded-[22px] border border-border/65 bg-surface" />;
  }

  return (
    <div
      aria-label={label}
      className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-[22px] border border-border/65 bg-white p-3"
      role="img"
    >
      <Suspense fallback={<Skeleton className="h-full w-full rounded-[18px]" />}>
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
      </Suspense>
    </div>
  );
}

function LinkCopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();

  return (
    <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[22px] bg-muted/60 px-3 py-2 transition-colors hover:bg-muted">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{value || '--'}</div>
      </div>
      <Button
        aria-label={`${t('common.copy')} ${label}`}
        className="shrink-0"
        disabled={!value}
        onClick={async () => {
          if (!value) return;
          await navigator.clipboard.writeText(value);
          toast.success(t('common.copied', { label }));
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
