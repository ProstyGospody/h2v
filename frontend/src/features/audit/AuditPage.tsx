import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { AuditEntry } from '@/shared/api/types';
import { Card, PageHeader } from '@/shared/ui/primitives';

export function AuditPage() {
  const audit = useQuery({
    queryKey: ['audit'],
    queryFn: () => apiClient.request<AuditEntry[]>('/audit?limit=100'),
  });

  return (
    <div>
      <PageHeader title="Audit" subtitle="Administrative actions with actor and target context." />
      <div className="p-6">
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-slate-400">
              <tr>
                <th className="px-3 py-3 font-medium">Action</th>
                <th className="px-3 py-3 font-medium">Target</th>
                <th className="px-3 py-3 font-medium">IP</th>
                <th className="px-3 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5">
                  <td className="px-3 py-3 text-white">{entry.action}</td>
                  <td className="px-3 py-3 text-slate-300">
                    {entry.target_type}:{entry.target_id}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{entry.ip || '—'}</td>
                  <td className="px-3 py-3 text-slate-300">{new Date(entry.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

