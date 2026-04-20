import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { AuditEntry } from '@/shared/api/types';
import { formatShortDateTime } from '@/shared/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader, Skeleton } from '@/shared/ui/primitives';

export function AuditPage() {
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => apiClient.request<AuditEntry[]>('/audit?limit=100'),
  });

  return (
    <div className="pb-8">
      <PageHeader title="Audit" subtitle="Administrative actions, targets, and attached metadata." />

      <div className="px-5 pt-5 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent events</CardTitle>
            <CardDescription>Timeline view with actor context and raw metadata for debugging.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            {audit.isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 8 }).map((_, index) => (
                  <Skeleton key={index} className="h-20 w-full" />
                ))}
              </div>
            ) : audit.data?.length ? (
              audit.data.map((entry) => <AuditRow entry={entry} key={entry.id} />)
            ) : (
              <div className="p-6">
                <EmptyState description="Administrative activity will appear here once the panel starts processing changes." title="No audit events yet" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const actor = entry.admin_id ? 'admin' : 'system';
  const metadata = entry.metadata ? JSON.stringify(entry.metadata) : '';

  return (
    <div className="border-b border-border px-6 py-4 last:border-none">
      <div className="grid gap-4 lg:grid-cols-[120px_100px_1fr_160px] lg:items-start">
        <div className="text-xs text-muted-foreground">{formatShortDateTime(entry.created_at)}</div>
        <div className={actor === 'system' ? 'text-sm text-muted-foreground' : 'text-sm font-medium text-foreground'}>{actor}</div>
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">{entry.action}</div>
          <div className="text-sm text-muted-foreground">
            {entry.target_type}:{entry.target_id || 'N/A'}
          </div>
          {metadata ? <pre className="overflow-x-auto rounded-md border border-border bg-surface-elevated p-3 text-xs text-muted-foreground">{metadata}</pre> : null}
        </div>
        <div className="space-y-1 text-right text-xs text-muted-foreground">
          <div>{entry.ip || 'N/A'}</div>
          <div className="truncate">{entry.user_agent || 'N/A'}</div>
        </div>
      </div>
    </div>
  );
}
