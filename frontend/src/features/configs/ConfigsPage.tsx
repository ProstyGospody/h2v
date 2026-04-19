import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { apiClient } from '@/shared/api/client';
import { Button, Card, PageHeader, SecondaryButton } from '@/shared/ui/primitives';

export function ConfigsPage() {
  const { core } = useParams({ from: '/app/configs/$core' });
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<{ content: string }>(`/configs/${core}`),
  });
  const [draft, setDraft] = useState('');

  const content = useMemo(() => draft || config.data?.content || '', [draft, config.data?.content]);

  const validateMutation = useMutation({
    mutationFn: () => apiClient.request(`/configs/${core}/validate`, { method: 'POST', body: JSON.stringify({ content }) }),
    onSuccess: () => toast.success('Config valid'),
  });

  const applyMutation = useMutation({
    mutationFn: () => apiClient.request(`/configs/${core}/apply`, { method: 'POST', body: JSON.stringify({ content }) }),
    onSuccess: async () => {
      toast.success('Config applied');
      await queryClient.invalidateQueries({ queryKey: ['configs', core] });
    },
  });

  const history = useQuery({
    queryKey: ['configs', core, 'history'],
    queryFn: () => apiClient.request<Array<{ id: number; applied_at: string; note: string }>>(`/configs/${core}/history`),
  });

  return (
    <div>
      <PageHeader
        title={`Config: ${core}`}
        subtitle="Validate, compare, and apply runtime kernel configuration."
        action={
          <div className="flex gap-2">
            <SecondaryButton onClick={() => setDraft(config.data?.content ?? '')}>Reset</SecondaryButton>
            <SecondaryButton onClick={() => validateMutation.mutate()}>Validate</SecondaryButton>
            <Button onClick={() => applyMutation.mutate()}>Apply</Button>
          </div>
        }
      />
      <div className="grid gap-6 p-6 xl:grid-cols-[2fr_320px]">
        <Card className="p-0">
          <Editor
            height="70vh"
            language={core === 'xray' ? 'json' : 'yaml'}
            value={content}
            theme="vs-dark"
            onChange={(value) => setDraft(value ?? '')}
          />
        </Card>
        <Card>
          <div className="text-sm font-medium text-slate-200">Recent history</div>
          <div className="mt-4 space-y-3 text-sm">
            {history.data?.map((entry) => (
              <div key={entry.id} className="border-b border-white/5 pb-3">
                <div className="font-medium text-white">#{entry.id}</div>
                <div className="text-slate-500">{new Date(entry.applied_at).toLocaleString()}</div>
                <div className="mt-1 text-slate-400">{entry.note || 'Applied from UI'}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
