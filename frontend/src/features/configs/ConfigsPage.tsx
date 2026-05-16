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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { PageHeader } from '@/components/page-header';
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

const cores: Core[] = ['xray', 'hysteria'];

const coreMeta: Record<Core, CoreMeta> = {
  hysteria: { label: 'Hysteria 2', logo: 'hysteria', service: 'hysteria' },
  xray: { label: 'Xray', logo: 'xray', service: 'xray' },
};

const ConfigEditor = lazy(() =>
  import('./ConfigEditor').then((module) => ({ default: module.ConfigEditor })),
);

export function ConfigsPage() {
  const { t } = useI18n();

  return (
    <div className="pb-10">
      <PageHeader title={t('configs.title')} />

      <div className="grid gap-4 px-page pt-6 xl:grid-cols-2">
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
  const [validation, setValidation] = useState<ValidationState>('idle');

  const config = useQuery({
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<ConfigResponse>(`/configs/${core}`),
  });

  useEffect(() => {
    if (config.data?.content === undefined) return;
    setDraft(normalizeConfigText(config.data.content));
    setValidation('idle');
  }, [config.data?.content]);

  const original = normalizeConfigText(config.data?.content ?? '');
  const generated = normalizeConfigText(config.data?.managed_content ?? '');
  const content = draft ?? original;
  const dirty = Boolean(config.data && content !== original);
  const generatedDirty = Boolean(config.data && content !== generated);
  const hasOverride = Boolean(config.data?.has_override);
  const jsonState = useMemo(() => inspectJson(content, t), [content, t]);
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
      await queryClient.invalidateQueries({ queryKey: ['configs', core] });
    },
  });

  const canValidate = Boolean(config.data && dirty && jsonState.valid && !validate.isPending);
  const canApply = dirty && validation === 'valid' && jsonState.valid && !apply.isPending;

  async function reloadConfig() {
    const result = await config.refetch();
    if (result.data?.content === undefined) return;
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

  function resetToGenerated() {
    setDraft(generated);
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

  return (
    <>
      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface shadow-sm">
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
              isLoading={config.isLoading}
              jsonState={jsonState}
              validation={validation}
            />
          </div>
        </div>

        <div className="border-b border-border/55 bg-card/35 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={config.isFetching} onClick={reloadConfig} size="sm" variant="outline">
              <RefreshCw className={cn(config.isFetching && 'animate-spin')} />
              {t('configs.reload')}
            </Button>
            <Button disabled={!dirty} onClick={resetDraft} size="sm" variant="outline">
              <RotateCcw />
              {t('common.reset')}
            </Button>
            <Button disabled={!generatedDirty} onClick={resetToGenerated} size="sm" variant="outline">
              <RotateCcw />
              {t('configs.generated')}
            </Button>
            <Button disabled={!config.data || !jsonState.valid} onClick={formatDraft} size="sm" variant="outline">
              <Wand2 />
              {t('common.format')}
            </Button>
            <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
              <Button disabled={!canValidate} onClick={() => validate.mutate()} size="sm" variant="secondary">
                <CheckCircle2 />
                {t('common.validate')}
              </Button>
              <Button disabled={!canApply} onClick={() => setDiffOpen(true)} size="sm">
                <PlayCircle />
                {t('common.apply')}
              </Button>
            </div>
          </div>
        </div>

        {!jsonState.valid && !config.isLoading ? (
          <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
            {jsonState.message}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 bg-card p-2 sm:p-3">
          {config.isLoading ? (
            <Skeleton className="h-[68vh] min-h-[520px] w-full xl:h-[calc(100vh-256px)] xl:min-h-[620px]" />
          ) : config.isError ? (
            <div className="flex h-[68vh] min-h-[520px] flex-col items-center justify-center gap-3 rounded-md border border-border/65 bg-card px-6 text-center xl:h-[calc(100vh-256px)] xl:min-h-[620px]">
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
                <Skeleton className="h-[68vh] min-h-[520px] w-full xl:h-[calc(100vh-256px)] xl:min-h-[620px]" />
              }
            >
              <ConfigEditor
                className="h-[68vh] min-h-[520px] xl:h-[calc(100vh-256px)] xl:min-h-[620px]"
                label={t('configs.configurationEditor', { name: meta.label })}
                onChange={updateDraft}
                value={content}
              />
            </Suspense>
          )}
        </div>
      </section>

      <Dialog onOpenChange={setDiffOpen} open={diffOpen}>
        <DialogContent className="grid max-h-[92vh] w-[calc(100vw-32px)] max-w-none grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-[min(calc(100vw-48px),1180px)] sm:max-w-none">
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
            <DiffMetric label={t('configs.current')} value={t('common.lines', { count: diffStats.currentLines })} />
            <DiffMetric label={t('configs.new')} value={t('common.lines', { count: diffStats.nextLines })} />
            <DiffMetric label={t('configs.changed')} value={t('common.lines', { count: diffStats.changed })} />
          </div>

          <div className="grid min-h-0 gap-3 overflow-auto bg-card p-3 md:grid-cols-2">
            <DiffView label={t('configs.current')} value={original} />
            <DiffView label={t('configs.new')} value={content} />
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
  isLoading,
  jsonState,
  validation,
}: {
  dirty: boolean;
  hasOverride: boolean;
  isChecking: boolean;
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

function DiffView({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const stats = contentStats(value);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border/55 bg-surface px-3 py-2">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <div className="font-mono text-[10px] text-muted-foreground">
          {t('common.lines', { count: stats.lines })} / {formatBytes(stats.bytes)}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<Skeleton className="h-full min-h-[360px] w-full rounded-none" />}>
          <ConfigEditor
            className="h-[42vh] min-h-[320px] rounded-none border-0 md:h-[50vh] md:min-h-[360px]"
            label={t('configs.previewEditor', { label })}
            onChange={() => undefined}
            readOnly
            value={value}
          />
        </Suspense>
      </div>
    </div>
  );
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

function errorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
