import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Clock3,
  FileClock,
  FileJson2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

const coreMeta: Record<Core, { icon: typeof FileJson2; label: string; service: string }> = {
  xray: { icon: FileJson2, label: 'Xray', service: 'xray' },
  hysteria: { icon: Braces, label: 'Hysteria', service: 'hysteria' },
};

const ConfigEditor = lazy(() =>
  import('./ConfigEditor').then((module) => ({ default: module.ConfigEditor })),
);

function asCore(value: unknown): Core | null {
  if (value === 'xray' || value === 'hysteria') {
    return value;
  }
  return null;
}

export function ConfigsPage() {
  const { core: rawCore } = useParams({ from: '/app/configs/$core' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const core = asCore(rawCore);

  const [draft, setDraft] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>('idle');
  const [diffOpen, setDiffOpen] = useState(false);

  const config = useQuery({
    enabled: Boolean(core),
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<ConfigResponse>(`/configs/${core}`),
  });

  const history = useQuery({
    enabled: Boolean(core),
    queryKey: ['configs', core, 'history'],
    queryFn: () => apiClient.request<ConfigHistoryEntry[]>(`/configs/${core}/history`),
  });

  useEffect(() => {
    setDraft(null);
    setDiffOpen(false);
    setValidation('idle');
  }, [core]);

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
      toast.error(error instanceof ApiError ? error.message : 'Validation failed');
    },
    onSuccess: () => {
      setValidation('valid');
      toast.success('Configuration is valid');
    },
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      apiClient.request(`/configs/${core}/apply`, {
        body: JSON.stringify({ content }),
        method: 'POST',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to apply configuration');
    },
    onSuccess: async () => {
      toast.success('Configuration applied');
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
      toast.error(error instanceof ApiError ? error.message : 'Unable to restore version');
    },
    onSuccess: async () => {
      toast.success('Previous version restored');
      setDiffOpen(false);
      setValidation('idle');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  if (!core) {
    return <UnknownCore onSelect={(nextCore) => navigateToCore(navigate, nextCore)} />;
  }

  const canValidate = Boolean(config.data && dirty && jsonState.valid && !validateMutation.isPending);
  const readyToApply = dirty && validation === 'valid' && jsonState.valid && !applyMutation.isPending;
  const Icon = coreMeta[core].icon;

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
      toast.success('JSON formatted');
    } catch {
      toast.error('JSON contains syntax errors');
    }
  }

  return (
    <div className="pb-10">
      <header className="px-5 pb-2 pt-8 sm:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className="size-4" />
              <span className="t-label">Configs</span>
            </div>
            <h1 className="text-[26px] font-semibold leading-none text-foreground">
              {coreMeta[core].label}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Tabs onValueChange={(value) => navigateToCore(navigate, value as Core)} value={core}>
              <TabsList>
                <TabsTrigger value="xray">Xray</TabsTrigger>
                <TabsTrigger value="hysteria">Hysteria</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button disabled={config.isFetching} onClick={reloadConfig} size="sm" variant="secondary">
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
      </header>

      <div className="grid gap-4 px-5 pt-5 sm:px-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="border-b px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <FileJson2 className="size-4 text-muted-foreground" />
                  Editor
                </CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{stats.lines} lines</span>
                  <span className="text-muted-foreground/40">/</span>
                  <span>{formatBytes(stats.bytes)}</span>
                  <span className="text-muted-foreground/40">/</span>
                  <span>{diffStats.changed} changed</span>
                </div>
              </div>
              <EditorStatus
                dirty={dirty}
                isChecking={validateMutation.isPending}
                jsonState={jsonState}
                validation={validation}
              />
            </div>
          </CardHeader>

          <CardContent className="px-0 pb-0">
            {config.isLoading ? (
              <Skeleton className="h-[62vh] min-h-[430px] w-full rounded-none" />
            ) : config.isError ? (
              <div className="flex h-[62vh] min-h-[430px] flex-col items-center justify-center gap-3 px-6 text-center">
                <XCircle className="size-8 text-destructive" />
                <div className="text-base font-semibold">Unable to load configuration</div>
                <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(config.error)}</p>
                <Button onClick={() => config.refetch()} size="sm" variant="secondary">
                  <RefreshCw />
                  Retry
                </Button>
              </div>
            ) : (
              <Suspense fallback={<Skeleton className="h-[62vh] min-h-[430px] w-full rounded-none" />}>
                <ConfigEditor
                  className="h-[62vh] min-h-[430px] rounded-none border-0"
                  label={`${coreMeta[core].label} configuration editor`}
                  onChange={(nextValue) => {
                    setDraft(nextValue);
                    setValidation('idle');
                  }}
                  value={content}
                />
              </Suspense>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="px-5 pt-5">
              <CardTitle className="flex items-center gap-2">
                <Clock3 className="size-4 text-muted-foreground" />
                State
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-5">
              <InfoRow label="Service" value={coreMeta[core].service} />
              <InfoRow label="JSON" value={jsonState.valid ? 'Valid syntax' : 'Syntax error'} />
              <InfoRow label="Server check" value={validationLabel(validation, validateMutation.isPending)} />
              <InfoRow label="Unsaved" value={dirty ? 'Yes' : 'No'} />
              {!jsonState.valid ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {jsonState.message}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-5 pt-5">
              <CardTitle className="flex items-center gap-2">
                <FileClock className="size-4 text-muted-foreground" />
                History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 px-3 pb-4">
              {history.isLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton className="mx-2 h-14 w-[calc(100%-16px)]" key={index} />
                ))
              ) : history.isError ? (
                <div className="px-3 py-6 text-center text-xs text-destructive">Failed to load history</div>
              ) : history.data?.length ? (
                history.data.map((entry) => (
                  <HistoryItem
                    disabled={restoreMutation.isPending && restoreMutation.variables === entry.id}
                    entry={entry}
                    key={entry.id}
                    onRestore={() => restoreMutation.mutate(entry.id)}
                  />
                ))
              ) : (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">No applied versions yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog onOpenChange={setDiffOpen} open={diffOpen}>
        <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Apply changes</DialogTitle>
            <DialogDescription>
              {coreMeta[core].label} will restart after the new configuration is written.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 sm:grid-cols-3">
            <DiffMetric label="Current" value={`${diffStats.currentLines} lines`} />
            <DiffMetric label="New" value={`${diffStats.nextLines} lines`} />
            <DiffMetric label="Changed" value={`${diffStats.changed} lines`} />
          </div>

          <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Active connections may briefly drop while {coreMeta[core].label} restarts.</span>
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
    </div>
  );
}

function UnknownCore({ onSelect }: { onSelect: (core: Core) => void }) {
  return (
    <div className="px-5 pb-10 pt-8 sm:px-8">
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="text-base font-semibold">Unknown config core</div>
          <p className="text-sm text-muted-foreground">Choose one of the available cores to continue.</p>
          <div className="flex gap-2">
            <Button onClick={() => onSelect('xray')} size="sm">
              Xray
            </Button>
            <Button onClick={() => onSelect('hysteria')} size="sm" variant="secondary">
              Hysteria
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditorStatus({
  dirty,
  isChecking,
  jsonState,
  validation,
}: {
  dirty: boolean;
  isChecking: boolean;
  jsonState: JsonState;
  validation: ValidationState;
}) {
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
  disabled,
  entry,
  onRestore,
}: {
  disabled: boolean;
  entry: ConfigHistoryEntry;
  onRestore: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition hover:bg-accent">
      <div className="min-w-0">
        <div className="font-mono text-xs text-foreground">v{entry.id}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {formatShortDateTime(entry.applied_at)}
        </div>
        {entry.note ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{entry.note}</div> : null}
      </div>
      <Button disabled={disabled} onClick={onRestore} size="sm" variant="ghost">
        <Undo2 />
        Restore
      </Button>
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
    <div className="rounded-md border px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function DiffPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-[42vh] min-h-0 flex-col overflow-hidden rounded-md border">
      <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">{value}</pre>
    </div>
  );
}

function navigateToCore(navigate: ReturnType<typeof useNavigate>, core: Core) {
  navigate({ params: { core }, to: '/configs/$core' });
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
