import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  Network,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/shared/api/client';
import { Setting } from '@/shared/api/types';
import { formatDate } from '@/shared/lib/format';

type GroupKey = 'protocols' | 'domains' | 'security' | 'misc';

type GroupMeta = {
  icon: ComponentType<{ className?: string }>;
  label: string;
};

type Group = GroupMeta & {
  items: Setting[];
  key: GroupKey;
};

const groupOrder: GroupKey[] = ['protocols', 'domains', 'security', 'misc'];

const groupMeta: Record<GroupKey, GroupMeta> = {
  domains: { icon: Globe2, label: 'Domains' },
  misc: { icon: SlidersHorizontal, label: 'Misc' },
  protocols: { icon: Network, label: 'Protocols' },
  security: { icon: ShieldCheck, label: 'Security' },
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeGroup, setActiveGroup] = useState<GroupKey>('protocols');
  const [draft, setDraft] = useState<Record<string, string>>({});

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.request<Setting[]>('/settings'),
  });

  const groups = useMemo(() => buildGroups(settings.data ?? []), [settings.data]);
  const currentGroup = groups.find((group) => group.key === activeGroup) ?? groups[0];
  const draftErrors = useMemo(() => validateDraft(draft), [draft]);
  const hasDraft = Object.keys(draft).length > 0;
  const hasInvalidDraft = Object.keys(draftErrors).length > 0;

  useEffect(() => {
    if (groups.length && !groups.some((group) => group.key === activeGroup)) {
      setActiveGroup(groups[0].key);
    }
  }, [activeGroup, groups]);

  const save = useMutation({
    mutationFn: () =>
      apiClient.request('/settings', {
        body: JSON.stringify(buildPayload(draft)),
        method: 'PATCH',
      }),
    onError: (error) => {
      if (error instanceof InvalidSettingsJSONError) {
        toast.error(error.message);
        return;
      }
      toast.error(error instanceof ApiError ? error.message : 'Unable to update settings');
    },
    onSuccess: async () => {
      toast.success('Settings updated');
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  function updateSetting(setting: Setting, value: string) {
    const original = settingText(setting.value);
    setDraft((current) => {
      if (value === original) {
        const next = { ...current };
        delete next[setting.key];
        return next;
      }
      return { ...current, [setting.key]: value };
    });
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Settings"
        action={
          hasDraft ? (
            <>
              <Button disabled={save.isPending} onClick={() => setDraft({})} size="sm" variant="ghost">
                <RotateCcw />
                Discard
              </Button>
              <Button
                disabled={save.isPending || hasInvalidDraft}
                onClick={() => save.mutate()}
                size="sm"
              >
                <Save />
                Save
              </Button>
            </>
          ) : null
        }
      />

      <div className="space-y-4 px-page pt-6">
        {settings.isLoading ? (
          <>
            <Skeleton className="h-10 w-full max-w-2xl" />
            <SettingsSkeleton />
          </>
        ) : settings.isError ? (
          <SettingsError error={settings.error} onRetry={() => settings.refetch()} />
        ) : currentGroup ? (
          <>
            <GroupPicker active={currentGroup.key} groups={groups} onChange={setActiveGroup} />
            <section className="grid gap-3 xl:grid-cols-2">
              {currentGroup.items.map((setting) => (
                <SettingCard
                  draftError={draftErrors[setting.key]}
                  draftValue={draft[setting.key]}
                  key={setting.key}
                  onChange={(value) => updateSetting(setting, value)}
                  setting={setting}
                />
              ))}
            </section>
          </>
        ) : (
          <EmptySettings />
        )}
      </div>
    </div>
  );
}

function GroupPicker({
  active,
  groups,
  onChange,
}: {
  active: GroupKey;
  groups: Group[];
  onChange: (key: GroupKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {groups.map((group) => {
        const Icon = group.icon;
        const selected = group.key === active;
        return (
          <Button
            className={cn('justify-start', !selected && 'text-muted-foreground')}
            key={group.key}
            onClick={() => onChange(group.key)}
            size="sm"
            type="button"
            variant={selected ? 'default' : 'outline'}
          >
            <Icon />
            {group.label}
            <span className="ml-1 rounded bg-background/35 px-1.5 font-mono text-[10px]">
              {group.items.length}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

function SettingCard({
  draftError,
  draftValue,
  onChange,
  setting,
}: {
  draftError?: string;
  draftValue?: string;
  onChange: (value: string) => void;
  setting: Setting;
}) {
  const original = settingText(setting.value);
  const value = draftValue ?? original;
  const dirty = draftValue !== undefined;
  const rows = Math.min(12, Math.max(4, value.split('\n').length));

  return (
    <Card className={cn('overflow-hidden', dirty && 'border-ring/55')}>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{titleize(setting.key)}</div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
              {setting.key}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {draftError ? (
              <Badge variant="destructive">
                <AlertTriangle />
                JSON
              </Badge>
            ) : dirty ? (
              <Badge variant="warning">Modified</Badge>
            ) : (
              <Badge variant="secondary">Synced</Badge>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">
              {formatDate(setting.updated_at)}
            </span>
          </div>
        </div>

        <Textarea
          className={cn(
            'resize-y font-mono text-xs leading-5',
            dirty && 'bg-accent-gradient-soft ring-2 ring-ring/20',
            draftError && 'border-destructive/60 ring-2 ring-destructive/20',
          )}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          value={value}
        />

        <div className="flex min-h-5 items-center gap-2 text-xs">
          {draftError ? (
            <>
              <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
              <span className="truncate text-destructive">{draftError}</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3.5 shrink-0 text-success" />
              <span className="text-muted-foreground">Valid JSON</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsSkeleton() {
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-4 w-24" />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function SettingsError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <div className="text-base font-semibold text-foreground">Unable to load settings</div>
        <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(error)}</p>
        <Button onClick={onRetry} size="sm" variant="secondary">
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptySettings() {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div className="space-y-1">
          <div className="text-base font-semibold text-foreground">No settings</div>
          <p className="max-w-md text-sm text-muted-foreground">
            Settings bootstrap has not created any values yet.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function buildGroups(items: Setting[]): Group[] {
  const buckets: Record<GroupKey, Setting[]> = {
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

  return groupOrder
    .map((key) => ({ ...groupMeta[key], items: buckets[key], key }))
    .filter((group) => group.items.length);
}

function buildPayload(draft: Record<string, string>) {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    try {
      payload[key] = JSON.parse(value);
    } catch {
      throw new InvalidSettingsJSONError(`Invalid JSON in ${key}`);
    }
  }
  return payload;
}

function validateDraft(draft: Record<string, string>) {
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    try {
      JSON.parse(value);
    } catch (error) {
      errors[key] = error instanceof Error ? error.message : 'Invalid JSON';
    }
  }
  return errors;
}

function settingText(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function titleize(key: string): string {
  return key
    .split('.')
    .map((part) => part.split('_').join(' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Request failed';
}

class InvalidSettingsJSONError extends Error {}
