import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Wand2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/shared/api/client';
import { formatBytes } from '@/shared/lib/format';

type Core = 'xray' | 'hysteria';
type ValidationState = 'idle' | 'valid' | 'invalid';

type ConfigResponse = {
  content: string;
};

type CoreMeta = {
  label: string;
  logo: CoreLogoName;
  service: string;
};

type JsonState =
  | {
      message?: undefined;
      valid: true;
    }
  | {
      message: string;
      valid: false;
    };

const cores: Core[] = ['xray', 'hysteria'];

const coreMeta: Record<Core, CoreMeta> = {
  hysteria: { label: 'Hysteria 2', logo: 'hysteria', service: 'hysteria' },
  xray: { label: 'Xray', logo: 'xray', service: 'xray' },
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
          <ConfigPanel core={core} key={core} />
        ))}
      </div>
    </div>
  );
}

function ConfigPanel({ core }: { core: Core }) {
  const queryClient = useQueryClient();
  const meta = coreMeta[core];

  const [draft, setDraft] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [validation, setValidation] = useState<ValidationState>('idle');

  const config = useQuery({
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<ConfigResponse>(`/configs/${core}`),
  });

  useEffect(() => {
    if (config.data?.content === undefined) return;
    setDraft(config.data.content);
    setValidation('idle');
  }, [config.data?.content]);

  const original = config.data?.content ?? '';
  const content = draft ?? original;
  const dirty = Boolean(config.data && content !== original);
  const jsonState = useMemo(() => inspectJson(content), [content]);
  const stats = useMemo(() => contentStats(content), [content]);
  const diffStats = useMemo(() => summarizeDiff(original, content), [original, content]);

  const validate = useMutation({
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

  const apply = useMutation({
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
      await queryClient.invalidateQueries({ queryKey: ['configs', core] });
    },
  });

  const canValidate = Boolean(config.data && dirty && jsonState.valid && !validate.isPending);
  const canApply = dirty && validation === 'valid' && jsonState.valid && !apply.isPending;

  async function reloadConfig() {
    const result = await config.refetch();
    if (result.data?.content === undefined) return;
    setDraft(result.data.content);
    setValidation('idle');
  }

  function updateDraft(nextValue: string) {
    setDraft(nextValue);
    setValidation('idle');
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
      <section className="min-w-0 overflow-hidden rounded-lg border border-border/65 bg-card shadow-sm">
        <div className="border-b border-border/55 bg-surface px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent-gradient-soft">
                  <CoreLogo className="size-5" core={meta.logo} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold leading-6 text-foreground">
                    {meta.label}
                  </h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span>{meta.service}</span>
                    <span className="text-muted-foreground/35">/</span>
                    <span>{stats.lines} lines</span>
                    <span className="text-muted-foreground/35">/</span>
                    <span>{formatBytes(stats.bytes)}</span>
                  </div>
                </div>
              </div>
              <ConfigStatus
                dirty={dirty}
                isChecking={validate.isPending}
                isLoading={config.isLoading}
                jsonState={jsonState}
                validation={validation}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={config.isFetching} onClick={reloadConfig} size="sm" variant="outline">
                <RefreshCw className={cn(config.isFetching && 'animate-spin')} />
                Reload
              </Button>
              <Button disabled={!dirty} onClick={resetDraft} size="sm" variant="outline">
                <RotateCcw />
                Reset
              </Button>
              <Button disabled={!config.data || !jsonState.valid} onClick={formatDraft} size="sm" variant="outline">
                <Wand2 />
                Format
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button disabled={!canValidate} onClick={() => validate.mutate()} size="sm" variant="secondary">
                  <CheckCircle2 />
                  Validate
                </Button>
                <Button disabled={!canApply} onClick={() => setDiffOpen(true)} size="sm">
                  <PlayCircle />
                  Apply
                </Button>
              </div>
            </div>

            {!jsonState.valid && !config.isLoading ? (
              <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {jsonState.message}
              </div>
            ) : null}
          </div>
        </div>

        <div className="p-3 sm:p-4">
          {config.isLoading ? (
            <Skeleton className="h-[68vh] min-h-[520px] w-full xl:h-[calc(100vh-256px)] xl:min-h-[620px]" />
          ) : config.isError ? (
            <div className="flex h-[68vh] min-h-[520px] flex-col items-center justify-center gap-3 rounded-md border border-border/65 bg-card px-6 text-center xl:h-[calc(100vh-256px)] xl:min-h-[620px]">
              <XCircle className="size-8 text-destructive" />
              <div className="text-base font-semibold text-foreground">Unable to load {meta.label}</div>
              <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(config.error)}</p>
              <Button onClick={() => config.refetch()} size="sm" variant="secondary">
                <RefreshCw />
                Retry
              </Button>
            </div>
          ) : (
            <Suspense
              fallback={
                <Skeleton className="h-[68vh] min-h-[520px] w-full xl:h-[calc(100vh-256px)] xl:min-h-[620px]" />
              }
            >
              <ConfigEditor
                className="h-[68vh] min-h-[520px] xl:h-[calc(100vh-256px)] xl:min-h-[620px]"
                label={`${meta.label} configuration editor`}
                onChange={updateDraft}
                value={content}
              />
            </Suspense>
          )}
        </div>
      </section>

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
            <Button disabled={apply.isPending} onClick={() => apply.mutate()}>
              <PlayCircle />
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConfigStatus({
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
  if (isLoading) return <Badge variant="secondary">Loading</Badge>;
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
  if (!dirty) return <Badge variant="secondary">Synced</Badge>;
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
  return <Badge variant="warning">Modified</Badge>;
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

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Request failed';
}
