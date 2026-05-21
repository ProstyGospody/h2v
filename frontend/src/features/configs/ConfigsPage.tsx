import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Wand2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/shared/api/client';
import { useI18n, type Translate } from '@/shared/i18n/i18n';
import { formatBytes } from '@/shared/lib/format';

type Core = 'xray' | 'hysteria';
type ValidationState = 'idle' | 'valid' | 'invalid';

type ConfigResponse = {
  content: string;
  has_override?: boolean;
  managed_content?: string;
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

type DiffRowState = 'added' | 'changed' | 'removed' | 'unchanged';

type DiffRow = {
  currentLine: string;
  currentLineNumber: number | null;
  nextLine: string;
  nextLineNumber: number | null;
  state: DiffRowState;
};

type DiffSummary = {
  changed: number;
  currentLines: number;
  nextLines: number;
  rows: DiffRow[];
};

const cores: Core[] = ['xray', 'hysteria'];
const jsonInspectDebounceMs = 300;
const emptyDiffSummary: DiffSummary = { changed: 0, currentLines: 0, nextLines: 0, rows: [] };
const configActionButtonClass = 'size-10 shrink-0 rounded-md p-0 sm:size-9';

const coreMeta: Record<Core, CoreMeta> = {
  hysteria: { label: 'Hysteria 2', logo: 'hysteria', service: 'hysteria' },
  xray: { label: 'Xray', logo: 'xray', service: 'xray' },
};

const ConfigEditor = lazy(() =>
  import('./ConfigEditor').then((module) => ({ default: module.ConfigEditor })),
);

export function ConfigsPage() {
  return (
    <div className="pb-10 lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden lg:pb-6">
      <div className="grid gap-4 overflow-y-auto px-page pt-5 lg:min-h-0 lg:flex-1 lg:pt-6 xl:grid-cols-2 xl:overflow-visible">
        {cores.map((core) => (
          <ConfigSection core={core} key={core} />
        ))}
      </div>
    </div>
  );
}

function ConfigSection({ core }: { core: Core }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const meta = coreMeta[core];

  const [draft, setDraft] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [managedVersion, setManagedVersion] = useState(0);
  const [validation, setValidation] = useState<ValidationState>('idle');

  const config = useQuery({
    gcTime: 30_000,
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<ConfigResponse>(`/configs/${core}`),
  });
  const managedConfig = useQuery({
    enabled: false,
    gcTime: 30_000,
    queryKey: ['configs', core, 'managed', managedVersion],
    queryFn: () => apiClient.request<ConfigResponse>(`/configs/${core}?include_managed=1`),
  });

  useEffect(() => {
    if (config.data?.content === undefined) return;
    setDraft(normalizeConfigText(config.data.content));
    setManagedVersion((current) => current + 1);
    setValidation('idle');
  }, [config.data?.content]);

  const original = useMemo(() => normalizeConfigText(config.data?.content ?? ''), [config.data?.content]);
  const generated = useMemo(
    () =>
      managedConfig.data?.managed_content === undefined
        ? null
        : normalizeConfigText(managedConfig.data.managed_content),
    [managedConfig.data?.managed_content],
  );
  const content = draft ?? original;
  const deferredContent = useDeferredValue(content);
  const debouncedContent = useDebouncedValue(content, jsonInspectDebounceMs);
  const jsonPending = content !== debouncedContent;
  const dirty = Boolean(config.data && content !== original);
  const generatedDirty = Boolean(config.data && generated !== null && content !== generated);
  const hasOverride = Boolean(config.data?.has_override || managedConfig.data?.has_override);
  const jsonState = useMemo(() => inspectJson(debouncedContent, t), [debouncedContent, t]);
  const stats = useMemo(() => contentStats(deferredContent), [deferredContent]);
  const diff = useMemo(
    () => (diffOpen ? buildDiffSummary(original, content) : emptyDiffSummary),
    [content, diffOpen, original],
  );

  const validate = useMutation({
    mutationFn: () =>
      apiClient.request(`/configs/${core}/validate`, {
        body: JSON.stringify({ content }),
        method: 'POST',
      }),
    onError: (error) => {
      setValidation('invalid');
      toast.error(error instanceof ApiError ? error.message : t('configs.validationFailed', { name: meta.label }));
    },
    onSuccess: () => {
      setValidation('valid');
      toast.success(t('configs.configurationValid', { name: meta.label }));
    },
  });

  const apply = useMutation({
    mutationFn: () =>
      apiClient.request(`/configs/${core}/apply`, {
        body: JSON.stringify({ content }),
        method: 'POST',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('configs.unableApply', { name: meta.label }));
    },
    onSuccess: async () => {
      toast.success(t('configs.configurationApplied', { name: meta.label }));
      setDiffOpen(false);
      setValidation('idle');
      setManagedVersion((current) => current + 1);
      await queryClient.invalidateQueries({ queryKey: ['configs', core] });
    },
  });

  const canValidate = Boolean(config.data && dirty && !jsonPending && jsonState.valid && !validate.isPending);
  const canApply = dirty && validation === 'valid' && !jsonPending && jsonState.valid && !apply.isPending;

  async function reloadConfig() {
    const result = await config.refetch();
    if (result.data?.content === undefined) return;
    setManagedVersion((current) => current + 1);
    setDraft(normalizeConfigText(result.data.content));
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

  async function resetToGenerated() {
    const nextGenerated = await ensureGeneratedConfig();
    if (nextGenerated === null) return;
    setDraft(nextGenerated);
    setValidation('idle');
  }

  function formatDraft() {
    try {
      setDraft(JSON.stringify(JSON.parse(content), null, 2));
      setValidation('idle');
      toast.success(t('configs.formatJson', { name: meta.label }));
    } catch {
      toast.error(t('configs.jsonSyntaxError', { name: meta.label }));
    }
  }

  async function ensureGeneratedConfig(): Promise<string | null> {
    if (generated !== null) return generated;
    try {
      const result = await managedConfig.refetch();
      if (result.error) {
        throw result.error;
      }
      const managed = result.data?.managed_content;
      if (managed === undefined) return null;
      return normalizeConfigText(managed);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('configs.unableLoad', { name: meta.label }));
      return null;
    }
  }

  return (
    <>
      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface shadow-sm xl:h-full">
        <div className="border-b border-border/55 bg-background/35 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center">
              <CoreLogo className="size-8" core={meta.logo} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold leading-5 text-foreground">{meta.label}</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span>{meta.service}</span>
                <span className="text-muted-foreground/35">/</span>
                <span>{t('common.lines', { count: stats.lines })}</span>
                <span className="text-muted-foreground/35">/</span>
                <span>{formatBytes(stats.bytes)}</span>
              </div>
            </div>
            <ConfigStatus
              dirty={dirty}
              hasOverride={hasOverride}
              isChecking={validate.isPending}
              isJsonPending={jsonPending}
              isLoading={config.isLoading}
              jsonState={jsonState}
              validation={validation}
            />
          </div>
        </div>

        <div className="border-b border-border/55 bg-card/35 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-label={t('configs.reload')}
              className={configActionButtonClass}
              disabled={config.isFetching}
              onClick={reloadConfig}
              size="icon"
              title={t('configs.reload')}
              variant="outline"
            >
              <RefreshCw className={cn(config.isFetching && 'animate-spin')} />
              <span className="sr-only">{t('configs.reload')}</span>
            </Button>
            <Button
              aria-label={t('common.reset')}
              className={configActionButtonClass}
              disabled={!dirty}
              onClick={resetDraft}
              size="icon"
              title={t('common.reset')}
              variant="outline"
            >
              <RotateCcw />
              <span className="sr-only">{t('common.reset')}</span>
            </Button>
            <Button
              aria-label={t('configs.generated')}
              className={configActionButtonClass}
              disabled={!config.data || managedConfig.isFetching || (generated !== null && !generatedDirty)}
              onClick={() => void resetToGenerated()}
              size="icon"
              title={t('configs.generated')}
              variant="outline"
            >
              <Sparkles className={cn(managedConfig.isFetching && 'animate-spin')} />
              <span className="sr-only">{t('configs.generated')}</span>
            </Button>
            <Button
              aria-label={t('common.format')}
              className={configActionButtonClass}
              disabled={!config.data || jsonPending || !jsonState.valid}
              onClick={formatDraft}
              size="icon"
              title={t('common.format')}
              variant="outline"
            >
              <Wand2 />
              <span className="sr-only">{t('common.format')}</span>
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                aria-label={t('common.validate')}
                className={configActionButtonClass}
                disabled={!canValidate}
                onClick={() => validate.mutate()}
                size="icon"
                title={t('common.validate')}
                variant="secondary"
              >
                <CheckCircle2 />
                <span className="sr-only">{t('common.validate')}</span>
              </Button>
              <Button
                aria-label={t('common.apply')}
                className={configActionButtonClass}
                disabled={!canApply}
                onClick={() => setDiffOpen(true)}
                size="icon"
                title={t('common.apply')}
              >
                <PlayCircle />
                <span className="sr-only">{t('common.apply')}</span>
              </Button>
            </div>
          </div>
        </div>

        {!jsonPending && !jsonState.valid && !config.isLoading ? (
          <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
            {jsonState.message}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 bg-card p-2 sm:p-3">
          {config.isLoading ? (
            <Skeleton className="h-[68vh] min-h-[520px] w-full xl:h-full xl:min-h-0" />
          ) : config.isError ? (
            <div className="flex h-[68vh] min-h-[520px] flex-col items-center justify-center gap-3 rounded-md border border-border/65 bg-card px-6 text-center xl:h-full xl:min-h-0">
              <XCircle className="size-8 text-destructive" />
              <div className="text-base font-semibold text-foreground">
                {t('configs.unableLoad', { name: meta.label })}
              </div>
              <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(config.error, t('common.requestFailed'))}</p>
              <Button onClick={() => config.refetch()} size="sm" variant="secondary">
                <RefreshCw />
                {t('common.retry')}
              </Button>
            </div>
          ) : (
            <Suspense
              fallback={
                <Skeleton className="h-[68vh] min-h-[520px] w-full xl:h-full xl:min-h-0" />
              }
            >
              <ConfigEditor
                className="h-[68vh] min-h-[520px] xl:h-full xl:min-h-0"
                label={t('configs.configurationEditor', { name: meta.label })}
                onChange={updateDraft}
                value={content}
              />
            </Suspense>
          )}
        </div>
      </section>

      <Dialog onOpenChange={setDiffOpen} open={diffOpen}>
        <DialogContent className="grid max-h-[92vh] w-[calc(100vw_-_32px)] max-w-none grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw_-_48px),1180px)] sm:max-w-none">
          <DialogHeader className="border-b border-border/55 bg-surface px-5 py-4 pr-12">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center">
                <CoreLogo className="size-8" core={meta.logo} />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">{t('configs.applyCore', { name: meta.label })}</DialogTitle>
              </div>
            </div>
          </DialogHeader>

          <div className="grid gap-2 border-b border-border/55 bg-card/35 px-4 py-3 sm:grid-cols-3">
            <DiffMetric label={t('configs.current')} value={t('common.lines', { count: diff.currentLines })} />
            <DiffMetric label={t('configs.new')} value={t('common.lines', { count: diff.nextLines })} />
            <DiffMetric label={t('configs.changed')} value={t('common.lines', { count: diff.changed })} />
          </div>

          <div className="grid min-h-0 gap-3 overflow-auto bg-card p-3 md:grid-cols-2">
            <DiffView label={t('configs.current')} rows={diff.rows} side="current" value={original} />
            <DiffView label={t('configs.new')} rows={diff.rows} side="next" value={content} />
          </div>

          <DialogFooter className="items-stretch border-t border-border/55 bg-card/35 px-4 py-3 sm:items-center">
            <div className="mr-auto flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{t('configs.activeConnectionsWarning', { name: meta.label })}</span>
            </div>
            <Button onClick={() => setDiffOpen(false)} variant="secondary">
              {t('common.cancel')}
            </Button>
            <Button disabled={apply.isPending} onClick={() => apply.mutate()}>
              <PlayCircle />
              {t('common.apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConfigStatus({
  dirty,
  hasOverride,
  isChecking,
  isJsonPending,
  isLoading,
  jsonState,
  validation,
}: {
  dirty: boolean;
  hasOverride: boolean;
  isChecking: boolean;
  isJsonPending: boolean;
  isLoading: boolean;
  jsonState: JsonState;
  validation: ValidationState;
}) {
  const { t } = useI18n();

  if (isLoading) return <Badge variant="secondary">{t('common.loading')}</Badge>;
  if (isChecking) {
    return (
      <Badge variant="secondary">
        <RefreshCw className="animate-spin" />
        {t('configs.checking')}
      </Badge>
    );
  }
  if (isJsonPending && dirty) return <Badge variant="warning">{t('configs.modified')}</Badge>;
  if (!jsonState.valid) {
    return (
      <Badge variant="destructive">
        <XCircle />
        {t('configs.jsonError')}
      </Badge>
    );
  }
  if (!dirty && hasOverride) return <Badge variant="warning">{t('configs.override')}</Badge>;
  if (!dirty) return <Badge variant="secondary">{t('configs.synced')}</Badge>;
  if (validation === 'valid') {
    return (
      <Badge variant="success">
        <CheckCircle2 />
        {t('configs.valid')}
      </Badge>
    );
  }
  if (validation === 'invalid') {
    return (
      <Badge variant="destructive">
        <AlertTriangle />
        {t('configs.invalid')}
      </Badge>
    );
  }
  return <Badge variant="warning">{t('configs.modified')}</Badge>;
}

function DiffMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/55 bg-muted/35 px-3 py-2">
      <div className="t-label">{label}</div>
      <div className="mt-1 font-mono text-sm leading-5 text-foreground">{value}</div>
    </div>
  );
}

function DiffView({
  label,
  rows,
  side,
  value,
}: {
  label: string;
  rows: DiffRow[];
  side: 'current' | 'next';
  value: string;
}) {
  const { t } = useI18n();
  const stats = useMemo(() => contentStats(value), [value]);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/55 bg-surface px-3 py-2">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {t('common.lines', { count: stats.lines })} / {formatBytes(stats.bytes)}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div
          aria-label={t('configs.previewEditor', { label })}
          className="h-[42vh] min-h-[320px] overflow-auto bg-background/45 p-2 font-mono text-[11px] leading-5 text-foreground md:h-[50vh] md:min-h-[360px]"
        >
          <code className="block min-w-max">
            {rows.map((row, index) => {
              const lineNumber = side === 'current' ? row.currentLineNumber : row.nextLineNumber;
              const line = side === 'current' ? row.currentLine : row.nextLine;

              return (
                <span
                  className={cn(
                    'grid grid-cols-[3rem_1rem_minmax(42rem,1fr)] rounded-sm px-2',
                    diffRowClass(row.state, side),
                  )}
                  key={`${side}-${index}`}
                >
                  <span className="select-none pr-2 text-right text-muted-foreground/55">
                    {lineNumber ?? ''}
                  </span>
                  <span className="select-none text-muted-foreground/65">{diffMarker(row.state, side)}</span>
                  <span className={cn('whitespace-pre', line === '' && 'text-muted-foreground/35')}>
                    {line === '' ? ' ' : line}
                  </span>
                </span>
              );
            })}
          </code>
        </div>
      </div>
    </div>
  );
}

function diffRowClass(state: DiffRowState, side: 'current' | 'next') {
  if (state === 'unchanged') return '';
  if (side === 'current') {
    return state === 'added'
      ? 'bg-success/5 text-muted-foreground/45'
      : 'bg-destructive/12 text-foreground';
  }
  return state === 'removed'
    ? 'bg-destructive/5 text-muted-foreground/45'
    : 'bg-success/12 text-foreground';
}

function diffMarker(state: DiffRowState, side: 'current' | 'next') {
  if (state === 'unchanged') return '';
  if (side === 'current') return state === 'added' ? '' : '-';
  return state === 'removed' ? '' : '+';
}

function inspectJson(value: string, t: Translate): JsonState {
  try {
    JSON.parse(value);
    return { valid: true };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : t('configs.jsonError');
    return {
      message: describeJsonError(rawMessage, value, t),
      valid: false,
    };
  }
}

function describeJsonError(message: string, value: string, t?: Translate): string {
  const match = message.match(/position\s+(\d+)/i);
  if (!match) return message;
  const position = Number(match[1]);
  if (!Number.isFinite(position)) return message;

  const before = value.slice(0, position);
  const line = before.split('\n').length;
  const lastBreak = before.lastIndexOf('\n');
  const column = position - lastBreak;
  return t ? t('configs.lineColumn', { column, line, message }) : `${message} (line ${line}, column ${column})`;
}

function normalizeConfigText(value: string): string {
  return value.replace(/^(?:[ \t]*\r?\n)+/, '');
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function contentStats(value: string) {
  return {
    bytes: new TextEncoder().encode(value).length,
    lines: value ? value.split('\n').length : 0,
  };
}

function buildDiffSummary(current: string, next: string): DiffSummary {
  const currentLines = current ? current.split('\n') : [];
  const nextLines = next ? next.split('\n') : [];
  const length = Math.max(currentLines.length, nextLines.length);
  let changed = 0;
  const rows: DiffRow[] = [];

  for (let index = 0; index < length; index += 1) {
    const hasCurrentLine = index < currentLines.length;
    const hasNextLine = index < nextLines.length;
    const currentLine = currentLines[index] ?? '';
    const nextLine = nextLines[index] ?? '';
    let state: DiffRowState = 'unchanged';

    if (!hasCurrentLine) {
      state = 'added';
    } else if (!hasNextLine) {
      state = 'removed';
    } else if (currentLine !== nextLine) {
      state = 'changed';
    }

    if (state !== 'unchanged') {
      changed += 1;
    }

    rows.push({
      currentLine,
      currentLineNumber: hasCurrentLine ? index + 1 : null,
      nextLine,
      nextLineNumber: hasNextLine ? index + 1 : null,
      state,
    });
  }

  return {
    changed,
    currentLines: currentLines.length,
    nextLines: nextLines.length,
    rows,
  };
}

function errorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
