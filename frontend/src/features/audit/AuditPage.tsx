import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { apiClient } from '@/shared/api/client';
import { AuditEntry } from '@/shared/api/types';
import { formatDate, formatShortDateTime } from '@/shared/lib/format';
import { Card, EmptyState, Input, PageHeader, Skeleton, cn } from '@/shared/ui/primitives';

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
      <PageHeader
        title="Audit"
        subtitle="Administrative actions, targets, and attached metadata."
        action={
          <Input
            className="w-60"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by action, target..."
            value={query}
          />
        }
      />

      <div className="px-5 pt-6 sm:px-8">
        <Card className="overflow-hidden">
          {audit.isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-surface-elevated text-muted-foreground">
                  <tr>
                    <th className="t-label px-5 py-3 font-medium" style={{ width: 140 }}>Time</th>
                    <th className="t-label px-5 py-3 font-medium" style={{ width: 100 }}>Actor</th>
                    <th className="t-label px-5 py-3 font-medium">Action</th>
                    <th className="t-label px-5 py-3 font-medium">Target</th>
                    <th className="t-label hidden px-5 py-3 font-medium lg:table-cell" style={{ width: 140 }}>IP</th>
                    <th className="px-5 py-3" style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {groups.flatMap((group) => [
                    <tr key={`h-${group.day}`} className="border-t border-border bg-surface-sunken">
                      <td
                        className="t-label px-5 py-2 text-muted-foreground"
                        colSpan={6}
                      >
                        {group.label}
                      </td>
                    </tr>,
                    ...group.entries.map((entry) => <AuditRow entry={entry} key={entry.id} />),
                  ])}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6">
              <EmptyState
                description={
                  query
                    ? 'No entries match that filter — try a different action or target.'
                    : 'Administrative activity will appear here once the panel starts processing changes.'
                }
                title={query ? 'Nothing matches' : 'No audit events yet'}
              />
            </div>
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
      <tr
        className={cn(
          'border-t border-border/70 transition',
          hasDetails ? 'cursor-pointer hover:bg-[hsl(var(--hover-overlay))]' : '',
          open && 'bg-[hsl(var(--hover-overlay))]',
        )}
        onClick={() => hasDetails && setOpen((v) => !v)}
      >
        <td className="px-5 py-3 align-top">
          <div className="font-mono text-xs text-foreground">{time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
        </td>
        <td className="px-5 py-3 align-top">
          <span className={cn('text-xs', isSystem ? 'text-muted-foreground' : 'font-medium text-foreground')}>{actor}</span>
        </td>
        <td className="px-5 py-3 align-top">
          <span className="font-mono text-xs text-foreground">{entry.action}</span>
        </td>
        <td className="px-5 py-3 align-top">
          <span className="text-sm text-muted-foreground">
            <span className="text-foreground">{entry.target_type}</span>
            {entry.target_id ? <span className="ml-1 font-mono text-xs">:{entry.target_id}</span> : null}
          </span>
        </td>
        <td className="hidden px-5 py-3 align-top font-mono text-xs text-muted-foreground lg:table-cell">
          {entry.ip || '—'}
        </td>
        <td className="px-5 py-3 align-top text-muted-foreground">
          {hasDetails ? (open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />) : null}
        </td>
      </tr>
      {open && hasDetails ? (
        <tr className="border-t border-border/40 bg-surface-sunken">
          <td className="px-5 py-4" colSpan={6}>
            <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
              <div className="space-y-2 text-xs text-muted-foreground">
                <div>
                  <div className="t-label mb-1">Timestamp</div>
                  <div className="font-mono text-[11px] text-foreground">{formatShortDateTime(entry.created_at)}</div>
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
                    <div className="break-all font-mono text-[11px] text-muted-foreground">{entry.user_agent}</div>
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
          </td>
        </tr>
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
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return formatDate(d, 'EEEE, MMM d');
}
