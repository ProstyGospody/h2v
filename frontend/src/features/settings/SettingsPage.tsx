import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import { Setting } from '@/shared/api/types';

type GroupKey = 'protocols' | 'domains' | 'security' | 'misc';

type Group = {
  items: Setting[];
  key: GroupKey;
  label: string;
};

const meta: Record<GroupKey, { label: string }> = {
  protocols: { label: 'Protocols' },
  domains: { label: 'Domains' },
  security: { label: 'Security' },
  misc: { label: 'Misc' },
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.request<Setting[]>('/settings'),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const groups = useMemo(() => buildGroups(settings.data ?? []), [settings.data]);
  const [activeGroup, setActiveGroup] = useState<GroupKey>('protocols');

  useEffect(() => {
    if (groups.length && !groups.some((g) => g.key === activeGroup)) {
      setActiveGroup(groups[0].key);
    }
  }, [activeGroup, groups]);

  const save = useMutation({
    mutationFn: () => {
      let payload: Record<string, unknown>;
      try {
        payload = Object.fromEntries(
          Object.entries(draft).map(([k, v]) => [k, JSON.parse(v)]),
        );
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

  const currentGroup = groups.find((g) => g.key === activeGroup) ?? groups[0];
  const hasDraft = Object.keys(draft).length > 0;

  return (
    <div className="pb-10">
      <header className="px-5 pb-2 pt-8 sm:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-[26px] font-semibold leading-none tracking-[-0.01em] text-foreground">
              Settings
            </h1>
          </div>
          {hasDraft ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setDraft({})} size="sm" variant="ghost">
                Discard
              </Button>
              <Button disabled={save.isPending} onClick={() => save.mutate()} size="sm">
                Save
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <Tabs
        className="gap-6 px-5 pt-6 sm:px-8 lg:grid lg:grid-cols-[200px_1fr] lg:items-start"
        onValueChange={(value) => setActiveGroup(value as GroupKey)}
        value={currentGroup?.key ?? activeGroup}
      >
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0 lg:flex-col lg:items-stretch">
          {groups.map((group) => (
            <TabsTrigger
              className={cn(
                'h-auto min-w-[120px] justify-between rounded-md px-3 py-2 text-left text-sm',
                'data-[state=active]:bg-[hsl(var(--primary)/0.08)] data-[state=active]:text-foreground',
                'data-[state=active]:shadow-[inset_2px_0_0_hsl(var(--primary))]',
                'lg:w-full',
              )}
              key={group.key}
              value={group.key}
            >
              <span>{group.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {group.items.length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="space-y-3">
          {settings.isLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton className="h-40 w-full" key={i} />)
            : currentGroup
              ? (
                  <TabsContent className="mt-0 space-y-3" forceMount value={currentGroup.key}>
                    {currentGroup.items.map((setting) => (
                      <Card key={setting.key}>
                        <CardContent className="space-y-3 p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground">
                                {titleize(setting.key)}
                              </div>
                              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                                {setting.key}
                              </div>
                            </div>
                            <div className="shrink-0 text-[10px] text-muted-foreground">
                              {new Date(setting.updated_at).toLocaleDateString()}
                            </div>
                          </div>
                          <Textarea
                            className={cn(
                              'font-mono text-xs',
                              draft[setting.key] !== undefined && 'ring-2 ring-primary/30',
                            )}
                            onChange={(e) =>
                              setDraft((curr) => ({ ...curr, [setting.key]: e.target.value }))
                            }
                            rows={Math.min(
                              10,
                              Math.max(
                                3,
                                JSON.stringify(setting.value, null, 2).split('\n').length,
                              ),
                            )}
                            value={draft[setting.key] ?? JSON.stringify(setting.value, null, 2)}
                          />
                        </CardContent>
                      </Card>
                    ))}
                  </TabsContent>
                )
              : (
                  <Card>
                    <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
                      <div className="space-y-1">
                        <div className="text-base font-semibold text-foreground">No settings</div>
                        <p className="max-w-md text-sm text-muted-foreground">
                          Settings bootstrap hasn&apos;t created any values yet.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
        </div>
      </Tabs>
    </div>
  );
}

function buildGroups(items: Setting[]): Group[] {
  const buckets: Record<GroupKey, Setting[]> = {
    protocols: [],
    domains: [],
    security: [],
    misc: [],
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
    if (
      key.includes('domain') ||
      key.includes('sni') ||
      key.includes('dest') ||
      key.includes('masquerade')
    ) {
      buckets.domains.push(item);
      continue;
    }
    buckets.misc.push(item);
  }
  return (Object.keys(meta) as GroupKey[])
    .map((key) => ({ ...meta[key], items: buckets[key], key }))
    .filter((g) => g.items.length);
}

function titleize(key: string): string {
  return key
    .split('.')
    .map((part) => part.split('_').join(' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}
