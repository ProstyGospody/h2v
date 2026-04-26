import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  FileClock,
  FileCode2,
  FileJson2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
  Wand2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/shared/api/client';
import { formatBytes, formatShortDateTime } from '@/shared/lib/format';

type ValidationState = 'idle' | 'valid' | 'invalid';
type Core = 'xray' | 'hysteria';

type ConfigResponse = {
  content: string;
};

type ConfigHistoryEntry = {
  applied_at: string;
  id: number;
  note: string;
};

const cores: Core[] = ['xray', 'hysteria'];

const coreMeta: Record<Core, { icon: typeof FileJson2; label: string; service: string }> = {
  xray: { icon: FileJson2, label: 'Xray', service: 'xray' },
  hysteria: { icon: Braces, label: 'Hys2', service: 'hysteria' },
};

const ConfigEditor = lazy(() =>
  import('./ConfigEditor').then((module) => ({ default: module.ConfigEditor })),
);

export function ConfigsPage() {
  return (
    <div className="pb-10">
      <PageHeader title="Configs" />

      <div className="grid gap-4 px-page pt-6 xl:grid-cols-2">
        {cores.map((core) => (
          <ConfigCorePanel core={core} key={core} />
        ))}
      </div>
    </div>
  );
}

function ConfigCorePanel({ core }: { core: Core }) {
  const queryClient = useQueryClient();
  const meta = coreMeta[core];
  const Icon = meta.icon;

  const [draft, setDraft] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>('idle');
  const [diffOpen, setDiffOpen] = useState(false);

  const config = useQuery({
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<ConfigResponse>(`/configs/${core}`),
  });

  const history = useQuery({
    queryKey: ['configs', core, 'history'],
    queryFn: () => apiClient.request<ConfigHistoryEntry[]>(`/configs/${core}/history`),
  });

  useEffect(() => {
    if (config.data?.content !== undefined) {
      setDraft(config.data.content);
      setValidation('idle');
    }
  }, [config.data?.content]);

  const original = config.data?.content ?? '';
  const content = draft ?? original;
  const dirty = Boolean(config.data && content !== original);
  const jsonState = useMemo(() => inspectJson(content), [content]);
  const stats = useMemo(() => contentStats(content), [content]);
  const diffStats = useMemo(() => summarizeDiff(original, content), [original, content]);

  const validateMutation = useMutation({
    mutationFn: () =>
      apiClient.request(`/configs/${core}/validate`, {
        body: JSON.stringify({ content }),
        method: 'POST',
      }),
    onError: (error) => {
      setValidation('invalid');
      toast.error(error instanceof ApiError ? error.message : `${meta.label} validation failed`);
    },
    onSuccess: () => {
      setValidation('valid');
      toast.success(`${meta.label} configuration is valid`);
    },
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      apiClient.request(`/configs/${core}/apply`, {
        body: JSON.stringify({ content }),
        method: 'POST',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : `Unable to apply ${meta.label} configuration`);
    },
    onSuccess: async () => {
      toast.success(`${meta.label} configuration applied`);
      setDiffOpen(false);
      setValidation('idle');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiClient.request(`/configs/${core}/restore/${id}`, { method: 'POST' }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : `Unable to restore ${meta.label} version`);
    },
    onSuccess: async () => {
      toast.success(`${meta.label} previous version restored`);
      setDiffOpen(false);
      setValidation('idle');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: (id: number) => apiClient.request(`/configs/${core}/history/${id}`, { method: 'DELETE' }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : `Unable to delete ${meta.label} history entry`);
    },
    onSuccess: async () => {
      toast.success(`${meta.label} history entry deleted`);
      await queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] });
    },
  });

  const canValidate = Boolean(config.data && dirty && jsonState.valid && !validateMutation.isPending);
  const readyToApply = dirty && validation === 'valid' && jsonState.valid && !applyMutation.isPending;

  async function reloadConfig() {
    const result = await config.refetch();
    if (result.data?.content !== undefined) {
      setDraft(result.data.content);
      setValidation('idle');
    }
  }

  function resetDraft() {
    setDraft(original);
    setValidation('idle');
  }

  function formatDraft() {
    try {
      setDraft(JSON.stringify(JSON.parse(content), null, 2));
      setValidation('idle');
      toast.success(`${meta.label} JSON formatted`);
    } catch {
      toast.error(`${meta.label} JSON contains syntax errors`);
    }
  }

  return (
    <>
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="gap-3 bg-muted/25 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-gradient-soft text-foreground">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <CardTitle>{meta.label}</CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <span>{stats.lines}L</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{formatBytes(stats.bytes)}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{diffStats.changed} changed</span>
                </div>
              </div>
            </div>
            <EditorStatus
              dirty={dirty}
              isChecking={validateMutation.isPending}
              isLoading={config.isLoading}
              jsonState={jsonState}
              validation={validation}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button disabled={config.isFetching} onClick={reloadConfig} size="sm" variant="ghost">
              <RefreshCw className={cn(config.isFetching && 'animate-spin')} />
              Reload
            </Button>
            <Button disabled={!dirty} onClick={resetDraft} size="sm" variant="ghost">
              <RotateCcw />
              Reset
            </Button>
            <Button disabled={!config.data || !jsonState.valid} onClick={formatDraft} size="sm" variant="ghost">
              <Wand2 />
              Format
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              <Button disabled={!canValidate} onClick={() => validateMutation.mutate()} size="sm" variant="secondary">
                <CheckCircle2 />
                Validate
              </Button>
              <Button disabled={!readyToApply} onClick={() => setDiffOpen(true)} size="sm">
                <PlayCircle />
                Apply
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-0 pb-0">
          {config.isLoading ? (
            <Skeleton className="h-[56vh] min-h-[390px] w-full rounded-none" />
          ) : config.isError ? (
            <div className="flex h-[56vh] min-h-[390px] flex-col items-center justify-center gap-3 px-6 text-center">
              <XCircle className="size-8 text-destructive" />
              <div className="text-base font-semibold">Unable to load {meta.label}</div>
              <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(config.error)}</p>
              <Button onClick={() => config.refetch()} size="sm" variant="secondary">
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : (
            <Suspense fallback={<Skeleton className="h-[56vh] min-h-[390px] w-full rounded-none" />}>
              <ConfigEditor
                className="h-[56vh] min-h-[390px] rounded-none border-x-0 border-border/70"
                label={`${meta.label} configuration editor`}
                onChange={(nextValue) => {
                  setDraft(nextValue);
                  setValidation('idle');
                }}
                value={content}
              />
            </Suspense>
          )}

          <div className="grid bg-muted/15 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <section className="space-y-3 p-4">
              <div className="text-xs font-medium text-foreground">State</div>
              <InfoRow label="Service" value={meta.service} />
              <InfoRow label="JSON" value={jsonState.valid ? 'Valid syntax' : 'Syntax error'} />
              <InfoRow label="Server check" value={validationLabel(validation, validateMutation.isPending)} />
              <InfoRow label="Unsaved" value={dirty ? 'Yes' : 'No'} />
              {!jsonState.valid && !config.isLoading ? (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {jsonState.message}
                </div>
              ) : null}
            </section>

            <section className="min-w-0 p-3">
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-foreground">
                <FileClock className="size-3.5 text-muted-foreground" />
                History
              </div>
              <div className="max-h-56 space-y-1 overflow-auto pr-1">
                {history.isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => <Skeleton className="h-12 w-full" key={index} />)
                ) : history.isError ? (
                  <div className="px-3 py-6 text-center text-xs text-destructive">Failed to load history</div>
                ) : history.data?.length ? (
                  history.data.map((entry) => (
                    <HistoryItem
                      deleteDisabled={
                        deleteHistoryMutation.isPending && deleteHistoryMutation.variables === entry.id
                      }
                      entry={entry}
                      key={entry.id}
                      onDelete={() => deleteHistoryMutation.mutate(entry.id)}
                      onRestore={() => restoreMutation.mutate(entry.id)}
                      restoreDisabled={restoreMutation.isPending && restoreMutation.variables === entry.id}
                    />
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">No applied versions yet.</div>
                )}
              </div>
            </section>
          </div>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setDiffOpen} open={diffOpen}>
        <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Apply {meta.label}</DialogTitle>
            <DialogDescription>{meta.label} will restart after the new configuration is written.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 sm:grid-cols-3">
            <DiffMetric label="Current" value={`${diffStats.currentLines} lines`} />
            <DiffMetric label="New" value={`${diffStats.nextLines} lines`} />
            <DiffMetric label="Changed" value={`${diffStats.changed} lines`} />
          </div>

          <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Active connections may briefly drop while {meta.label} restarts.</span>
          </div>

          <div className="grid min-h-0 gap-3 overflow-hidden md:grid-cols-2">
            <DiffPanel label="Current" value={original} />
            <DiffPanel label="New" value={content} />
          </div>

          <DialogFooter>
            <Button onClick={() => setDiffOpen(false)} variant="secondary">
              Cancel
            </Button>
            <Button disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
              <PlayCircle />
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditorStatus({
  dirty,
  isChecking,
  isLoading,
  jsonState,
  validation,
}: {
  dirty: boolean;
  isChecking: boolean;
  isLoading: boolean;
  jsonState: JsonState;
  validation: ValidationState;
}) {
  if (isLoading) {
    return <Badge variant="secondary">Loading</Badge>;
  }
  if (isChecking) {
    return (
      <Badge variant="secondary">
        <RefreshCw className="animate-spin" />
        Checking
      </Badge>
    );
  }
  if (!jsonState.valid) {
    return (
      <Badge variant="destructive">
        <XCircle />
        JSON error
      </Badge>
    );
  }
  if (!dirty) {
    return <Badge variant="secondary">No changes</Badge>;
  }
  if (validation === 'valid') {
    return (
      <Badge variant="success">
        <CheckCircle2 />
        Valid
      </Badge>
    );
  }
  if (validation === 'invalid') {
    return (
      <Badge variant="destructive">
        <AlertTriangle />
        Invalid
      </Badge>
    );
  }
  return <Badge variant="warning">Needs validation</Badge>;
}

function HistoryItem({
  deleteDisabled,
  entry,
  onDelete,
  onRestore,
  restoreDisabled,
}: {
  deleteDisabled: boolean;
  entry: ConfigHistoryEntry;
  onDelete: () => void;
  onRestore: () => void;
  restoreDisabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition hover:bg-muted/45">
      <div className="min-w-0">
        <div className="font-mono text-xs text-foreground">v{entry.id}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {formatShortDateTime(entry.applied_at)}
        </div>
        {entry.note ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{entry.note}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button disabled={restoreDisabled} onClick={onRestore} size="sm" variant="ghost">
          <Undo2 />
          Restore
        </Button>
        <Button
          className="text-destructive hover:text-destructive"
          disabled={deleteDisabled}
          onClick={onDelete}
          size="sm"
          variant="ghost"
        >
          <Trash2 />
          Delete
        </Button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function DiffMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/55 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function DiffPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-[42vh] min-h-0 flex-col overflow-hidden rounded-md bg-muted/55">
      <div className="bg-background/35 px-3 py-2 text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">{value}</pre>
    </div>
  );
}

type JsonState =
  | {
      message?: undefined;
      valid: true;
    }
  | {
      message: string;
      valid: false;
    };

function inspectJson(value: string): JsonState {
  try {
    JSON.parse(value);
    return { valid: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'Invalid JSON',
      valid: false,
    };
  }
}

function contentStats(value: string) {
  return {
    bytes: new TextEncoder().encode(value).length,
    lines: value ? value.split('\n').length : 0,
  };
}

function summarizeDiff(current: string, next: string) {
  const currentLines = current ? current.split('\n') : [];
  const nextLines = next ? next.split('\n') : [];
  const length = Math.max(currentLines.length, nextLines.length);
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (currentLines[index] !== nextLines[index]) {
      changed += 1;
    }
  }
  return {
    changed,
    currentLines: currentLines.length,
    nextLines: nextLines.length,
  };
}

function validationLabel(validation: ValidationState, isChecking: boolean): string {
  if (isChecking) return 'Checking';
  if (validation === 'valid') return 'Valid';
  if (validation === 'invalid') return 'Invalid';
  return 'Not checked';
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Request failed';
}
