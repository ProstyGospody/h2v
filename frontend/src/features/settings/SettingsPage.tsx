import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/shared/api/client';
import { Setting } from '@/shared/api/types';
import {
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  SecondaryButton,
  Textarea,
  Button,
} from '@/shared/ui/primitives';

type SettingsGroupKey = 'protocols' | 'domains' | 'security' | 'misc';

type SettingsGroup = {
  description: string;
  items: Setting[];
  key: SettingsGroupKey;
  label: string;
};

const groupMeta: Record<SettingsGroupKey, { description: string; label: string }> = {
  domains: {
    description: 'Public-facing domains, SNI, and destinations.',
    label: 'Domains',
  },
  misc: {
    description: 'Everything else that does not fit protocol or security buckets.',
    label: 'Misc',
  },
  protocols: {
    description: 'Runtime protocol knobs for VLESS and Hysteria.',
    label: 'Protocols',
  },
  security: {
    description: 'Reality keys and other security-sensitive values.',
    label: 'Security',
  },
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.request<Setting[]>('/settings'),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const groups = useMemo(() => buildGroups(settings.data ?? []), [settings.data]);
  const [activeGroup, setActiveGroup] = useState<SettingsGroupKey>('protocols');

  useEffect(() => {
    if (groups.length && !groups.some((group) => group.key === activeGroup)) {
      setActiveGroup(groups[0].key);
    }
  }, [activeGroup, groups]);

  const save = useMutation({
    mutationFn: () => {
      let payload: Record<string, unknown>;
      try {
        payload = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, JSON.parse(value)]));
      } catch {
        toast.error('One or more settings contain invalid JSON');
        throw new Error('invalid_json');
      }
      return apiClient.request('/settings', {
        body: JSON.stringify(payload),
        method: 'PATCH',
      });
    },
    onSuccess: async () => {
      toast.success('Settings updated');
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const currentGroup = groups.find((group) => group.key === activeGroup) ?? groups[0];

  return (
    <div className="pb-8">
      <PageHeader
        title="Settings"
        subtitle="Protocol, domain, and security values backed by runtime configuration."
        action={
          <>
            <SecondaryButton onClick={() => setDraft({})} type="button">
              Discard
            </SecondaryButton>
            <Button busy={save.isPending} disabled={!Object.keys(draft).length} onClick={() => save.mutate()} type="button">
              Save changes
            </Button>
          </>
        }
      />

      <div className="grid gap-6 px-5 pt-5 sm:px-6 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit">
          <CardContent className="p-3">
            <div className="space-y-1">
              {groups.map((group) => (
                <button
                  key={group.key}
                  className={
                    group.key === currentGroup?.key
                      ? 'flex w-full items-start justify-between rounded-md border border-primary/20 bg-primary/10 px-3 py-3 text-left'
                      : 'flex w-full items-start justify-between rounded-md border border-transparent px-3 py-3 text-left transition hover:border-border hover:bg-[hsl(var(--hover-overlay))]'
                  }
                  onClick={() => setActiveGroup(group.key)}
                  type="button"
                >
                  <div>
                    <div className="text-sm font-medium text-foreground">{group.label}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{group.description}</div>
                  </div>
                  <div className="t-label">{group.items.length}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {settings.isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-4">
                  <div className="skeleton h-5 w-48 rounded-md" />
                  <div className="skeleton h-28 w-full rounded-md" />
                </CardContent>
              </Card>
            ))
          ) : currentGroup ? (
            currentGroup.items.map((setting) => (
              <Card key={setting.key}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-base font-semibold text-foreground">{titleizeKey(setting.key)}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{describeSetting(setting.key)}</div>
                      </div>
                      <div className="t-label">{setting.key}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">Updated {new Date(setting.updated_at).toLocaleString()}</div>
                  </div>
                  <Textarea
                    rows={6}
                    value={draft[setting.key] ?? JSON.stringify(setting.value, null, 2)}
                    onChange={(event) => setDraft((current) => ({ ...current, [setting.key]: event.target.value }))}
                  />
                </CardContent>
              </Card>
            ))
          ) : (
            <EmptyState description="Settings bootstrap has not created any values yet." title="No runtime settings" />
          )}
        </div>
      </div>
    </div>
  );
}

function buildGroups(items: Setting[]): SettingsGroup[] {
  const buckets: Record<SettingsGroupKey, Setting[]> = {
    domains: [],
    misc: [],
    protocols: [],
    security: [],
  };

  for (const item of items) {
    const key = item.key;
    if (key.startsWith('vless.') || key.startsWith('hy2.')) {
      buckets.protocols.push(item);
      continue;
    }
    if (key.includes('public_key') || key.includes('short_ids')) {
      buckets.security.push(item);
      continue;
    }
    if (key.includes('domain') || key.includes('sni') || key.includes('dest') || key.includes('masquerade')) {
      buckets.domains.push(item);
      continue;
    }
    buckets.misc.push(item);
  }

  return (Object.keys(groupMeta) as SettingsGroupKey[])
    .map((key) => ({ ...groupMeta[key], items: buckets[key], key }))
    .filter((group) => group.items.length);
}

function titleizeKey(key: string): string {
  return key
    .split('.')
    .map((part) => part.replaceAll('_', ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}

function describeSetting(key: string): string {
  const descriptions: Record<string, string> = {
    'hy2.bandwidth_down': 'Advertised downstream bandwidth for Hysteria clients.',
    'hy2.bandwidth_up': 'Advertised upstream bandwidth for Hysteria clients.',
    'hy2.domain': 'Public domain used for Hysteria links.',
    'hy2.masquerade_url': 'Masquerade target served by Hysteria when probing.',
    'hy2.obfs_enabled': 'Obfuscation toggle for Hysteria transport.',
    'hy2.port': 'Listening port for Hysteria.',
    'panel.domain': 'Primary panel domain used for generated links.',
    'reality.dest': 'Reality destination used by the upstream handshake.',
    'reality.public_key': 'Published Reality public key.',
    'reality.short_ids': 'Allowed short IDs for Reality clients.',
    'reality.sni': 'Reality SNI announced to clients.',
    'vless.port': 'Listening port for the VLESS endpoint.',
  };
  return descriptions[key] ?? 'Stored as JSON and applied by the backend runtime.';
}
