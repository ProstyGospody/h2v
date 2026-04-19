import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/shared/api/client';
import { Setting } from '@/shared/api/types';
import { Button, Card, PageHeader, SecondaryButton, Textarea } from '@/shared/ui/primitives';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.request<Setting[]>('/settings'),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      let payload: Record<string, unknown>;
      try {
        payload = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, JSON.parse(value)]));
      } catch (error) {
        toast.error('One or more settings contain invalid JSON');
        throw error;
      }
      return apiClient.request('/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      toast.success('Settings updated');
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const entries = useMemo(() => settings.data ?? [], [settings.data]);

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Runtime protocol, domain, and bandwidth values."
        action={
          <div className="flex gap-2">
            <SecondaryButton onClick={() => setDraft({})}>Discard</SecondaryButton>
            <Button onClick={() => save.mutate()}>Save</Button>
          </div>
        }
      />
      <div className="grid gap-4 p-6">
        {entries.map((setting) => (
          <Card key={setting.key}>
            <div className="mb-3 text-sm font-medium text-white">{setting.key}</div>
            <Textarea
              rows={3}
              value={draft[setting.key] ?? JSON.stringify(setting.value, null, 2)}
              onChange={(event) => setDraft((current) => ({ ...current, [setting.key]: event.target.value }))}
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
