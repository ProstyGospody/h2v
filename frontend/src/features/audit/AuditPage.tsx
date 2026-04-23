import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import { AuditEntry } from '@/shared/api/types';
import { formatDate, formatShortDateTime } from '@/shared/lib/format';

export function AuditPage() {
  const [query, setQuery] = useState('');
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => apiClient.request<AuditEntry[]>('/audit?limit=100'),
  });

  const filtered = useMemo(() => {
    if (!audit.data) return [];
    if (!query.trim()) return audit.data;
    const needle = query.trim().toLowerCase();
    return audit.data.filter(
      (entry) =>
        entry.action.toLowerCase().includes(needle) ||
        (entry.target_type || '').toLowerCase().includes(needle) ||
        (entry.target_id || '').toLowerCase().includes(needle),
    );
  }, [audit.data, query]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <div className="pb-8">
      <header className="px-5 pb-2 pt-8 sm:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-[26px] font-semibold leading-none tracking-[-0.01em] text-foreground">
              Audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Administrative actions, targets, and attached metadata.
            </p>
          </div>
          <Input
            className="w-full sm:w-72"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by action, target..."
            value={query}
          />
        </div>
      </header>

      <div className="px-5 pt-6 sm:px-8">
        <Card className="overflow-hidden">
          {audit.isLoading ? (
            <CardContent className="space-y-2 p-6">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </CardContent>
          ) : filtered.length ? (
            <Table>
              <TableHeader className="bg-surface-elevated">
                <TableRow className="hover:bg-surface-elevated">
                  <TableHead className="px-5 py-3" style={{ width: 140 }}>
                    Time
                  </TableHead>
                  <TableHead className="px-5 py-3" style={{ width: 100 }}>
                    Actor
                  </TableHead>
                  <TableHead className="px-5 py-3">Action</TableHead>
                  <TableHead className="px-5 py-3">Target</TableHead>
                  <TableHead className="hidden px-5 py-3 lg:table-cell" style={{ width: 140 }}>
                    IP
                  </TableHead>
                  <TableHead className="px-5 py-3" style={{ width: 40 }} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.flatMap((group) => [
                  <TableRow
                    className="bg-surface-sunken hover:bg-surface-sunken"
                    key={`h-${group.day}`}
                  >
                    <TableCell
                      className="px-5 py-2 text-[11px] uppercase tracking-[0.06em] text-muted-foreground"
                      colSpan={6}
                    >
                      {group.label}
                    </TableCell>
                  </TableRow>,
                  ...group.entries.map((entry) => <AuditRow entry={entry} key={entry.id} />),
                ])}
              </TableBody>
            </Table>
          ) : (
            <CardContent className="p-6">
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                <div className="space-y-1">
                  <div className="text-base font-semibold text-foreground">
                    {query ? 'Nothing matches' : 'No audit events yet'}
                  </div>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {query
                      ? 'No entries match that filter. Try a different action or target.'
                      : 'Administrative activity will appear here once the panel starts processing changes.'}
                  </p>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const actor = entry.admin_id ? 'admin' : 'system';
  const isSystem = actor === 'system';
  const hasDetails = Boolean(entry.metadata || entry.user_agent || entry.ip);
  const time = new Date(entry.created_at);

  return (
    <>
      <TableRow
        className={cn(
          'border-border/70 transition',
          hasDetails ? 'cursor-pointer hover:bg-[hsl(var(--hover-overlay))]' : '',
          open && 'bg-[hsl(var(--hover-overlay))]',
        )}
        onClick={() => hasDetails && setOpen((value) => !value)}
      >
        <TableCell className="px-5 py-3 align-top">
          <div className="font-mono text-xs text-foreground">
            {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </div>
        </TableCell>
        <TableCell className="px-5 py-3 align-top">
          <span
            className={cn(
              'text-xs',
              isSystem ? 'text-muted-foreground' : 'font-medium text-foreground',
            )}
          >
            {actor}
          </span>
        </TableCell>
        <TableCell className="px-5 py-3 align-top">
          <span className="font-mono text-xs text-foreground">{entry.action}</span>
        </TableCell>
        <TableCell className="px-5 py-3 align-top">
          <span className="text-sm text-muted-foreground">
            <span className="text-foreground">{entry.target_type}</span>
            {entry.target_id ? (
              <span className="ml-1 font-mono text-xs">:{entry.target_id}</span>
            ) : null}
          </span>
        </TableCell>
        <TableCell className="hidden px-5 py-3 align-top font-mono text-xs text-muted-foreground lg:table-cell">
          {entry.ip || '--'}
        </TableCell>
        <TableCell className="px-5 py-3 align-top text-muted-foreground">
          {hasDetails ? (
            open ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )
          ) : null}
        </TableCell>
      </TableRow>
      {open && hasDetails ? (
        <TableRow className="bg-surface-sunken hover:bg-surface-sunken">
          <TableCell className="px-5 py-4" colSpan={6}>
            <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
              <div className="space-y-2 text-xs text-muted-foreground">
                <div>
                  <div className="t-label mb-1">Timestamp</div>
                  <div className="font-mono text-[11px] text-foreground">
                    {formatShortDateTime(entry.created_at)}
                  </div>
                </div>
                {entry.ip ? (
                  <div>
                    <div className="t-label mb-1">IP address</div>
                    <div className="font-mono text-[11px] text-foreground">{entry.ip}</div>
                  </div>
                ) : null}
                {entry.user_agent ? (
                  <div>
                    <div className="t-label mb-1">User agent</div>
                    <div className="break-all font-mono text-[11px] text-muted-foreground">
                      {entry.user_agent}
                    </div>
                  </div>
                ) : null}
              </div>
              {entry.metadata ? (
                <div className="space-y-1">
                  <div className="t-label">Metadata</div>
                  <pre className="overflow-x-auto rounded-md border border-border bg-surface-elevated p-3 font-mono text-[11px] text-foreground">
                    {JSON.stringify(entry.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

type AuditGroup = { day: string; entries: AuditEntry[]; label: string };

function groupByDay(entries: AuditEntry[]): AuditGroup[] {
  const groups = new Map<string, AuditGroup>();
  for (const entry of entries) {
    const key = entry.created_at.slice(0, 10);
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, { day: key, entries: [entry], label: formatDayLabel(entry.created_at) });
    }
  }
  return Array.from(groups.values());
}

function formatDayLabel(value: string): string {
  const d = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return formatDate(d, 'EEEE, MMM d');
}
