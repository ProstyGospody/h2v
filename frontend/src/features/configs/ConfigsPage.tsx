import { useEffect, useMemo, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, History, PlayCircle, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, ApiError } from '@/shared/api/client';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Modal,
  PageHeader,
  SecondaryButton,
  Skeleton,
  cn,
} from '@/shared/ui/primitives';

type ValidationState = 'idle' | 'valid' | 'invalid';

export function ConfigsPage() {
  const { core } = useParams({ from: '/app/configs/$core' });
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string>('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');
  const [diffOpen, setDiffOpen] = useState(false);

  const config = useQuery({
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<{ content: string }>(`/configs/${core}`),
  });

  useEffect(() => {
    setValidationState('idle');
    setDiffOpen(false);
  }, [core]);

  useEffect(() => {
    if (config.data?.content !== undefined) {
      setDraft(config.data.content);
    }
  }, [config.data?.content]);

  const content = useMemo(() => draft ?? config.data?.content ?? '', [draft, config.data?.content]);
  const original = config.data?.content ?? '';
  const dirty = Boolean(config.data && content !== original);

  const validateMutation = useMutation({
    mutationFn: () => apiClient.request(`/configs/${core}/validate`, { body: JSON.stringify({ content }), method: 'POST' }),
    onError: (error) => {
      setValidationState('invalid');
      toast.error(error instanceof ApiError ? error.message : 'Validation failed');
    },
    onSuccess: () => {
      setValidationState('valid');
      toast.success('Configuration is valid');
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => apiClient.request(`/configs/${core}/apply`, { body: JSON.stringify({ content }), method: 'POST' }),
    onSuccess: async () => {
      toast.success('Configuration applied');
      setValidationState('idle');
      setDiffOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  const history = useQuery({
    queryKey: ['configs', core, 'history'],
    queryFn: () => apiClient.request<Array<{ id: number; applied_at: string; note: string }>>(`/configs/${core}/history`),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiClient.request(`/configs/${core}/restore/${id}`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Previous version restored');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  const coreLabel = core === 'hysteria' ? 'Hysteria' : 'Xray';
  const readyToApply = dirty && validationState === 'valid';

  return (
    <div className="pb-8">
      <PageHeader
        eyebrow="Configs"
        title={`${coreLabel} config`}
        subtitle="Validate changes before apply. Writing a new runtime config restarts the selected core."
        action={
          <>
            <SecondaryButton
              disabled={!dirty}
              leadingIcon={<RotateCcw className="size-4" />}
              onClick={() => {
                setDraft(original);
                setValidationState('idle');
              }}
              type="button"
            >
              Reset
            </SecondaryButton>
            <SecondaryButton
              busy={validateMutation.isPending}
              disabled={!dirty}
              leadingIcon={<CheckCircle2 className="size-4" />}
              onClick={() => validateMutation.mutate()}
              type="button"
            >
              Validate
            </SecondaryButton>
            <Button
              disabled={!readyToApply}
              leadingIcon={<PlayCircle className="size-4" />}
              onClick={() => setDiffOpen(true)}
              type="button"
            >
              Apply
            </Button>
          </>
        }
      />

      <div className="px-5 pt-5 sm:px-8">
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-elevated p-1">
          <ConfigTab core="xray" label="Xray" />
          <ConfigTab core="hysteria" label="Hysteria" />
        </div>
      </div>

      <div className="px-5 pt-5 sm:px-8 md:hidden">
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="t-h2">Desktop required</div>
            <p className="text-sm text-muted-foreground">Configuration editing is intentionally desktop-only. Use a wider viewport to validate and apply changes safely.</p>
          </CardContent>
        </Card>
      </div>

      <div className="hidden gap-6 px-5 pt-5 sm:px-8 md:grid xl:grid-cols-[1.75fr_360px]">
        <Card className="overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>{coreLabel} editor</CardTitle>
                <CardDescription>JetBrains Mono, runtime JSON, and a single apply path.</CardDescription>
              </div>
              <ValidationIndicator dirty={dirty} state={validationState} />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              <AlertTriangle className="size-4" />
              Applying changes restarts {coreLabel}. Existing connections may briefly drop during reload.
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {config.isLoading ? (
              <Skeleton className="h-[70vh] w-full rounded-none" />
            ) : (
              <Editor
                height="70vh"
                language="json"
                onChange={(value) => {
                  setDraft(value ?? '');
                  setValidationState('idle');
                }}
                options={{
                  fontFamily: 'JetBrains Mono',
                  fontLigatures: false,
                  fontSize: 13,
                  minimap: { enabled: false },
                  padding: { top: 20, bottom: 20 },
                  scrollBeyondLastLine: false,
                }}
                theme="vs-dark"
                value={content}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <CardTitle>Recent history</CardTitle>
            </div>
            <CardDescription>Roll back to a previous version if something looks off.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {history.isLoading ? (
              Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)
            ) : history.data?.length ? (
              history.data.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border bg-surface-elevated p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-foreground">v{entry.id}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{new Date(entry.applied_at).toLocaleString()}</div>
                    </div>
                    <SecondaryButton
                      busy={restoreMutation.isPending && restoreMutation.variables === entry.id}
                      leadingIcon={<Undo2 className="size-3.5" />}
                      onClick={() => restoreMutation.mutate(entry.id)}
                      size="sm"
                      type="button"
                    >
                      Restore
                    </SecondaryButton>
                  </div>
                  {entry.note ? <div className="mt-2 text-xs text-muted-foreground">{entry.note}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">No applied versions yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {diffOpen ? (
        <Modal
          onClose={() => setDiffOpen(false)}
          size="xl"
          subtitle={`Review changes before restarting ${coreLabel}.`}
          title="Apply changes"
          footer={
            <>
              <SecondaryButton onClick={() => setDiffOpen(false)} type="button">
                Cancel
              </SecondaryButton>
              <Button
                busy={applyMutation.isPending}
                leadingIcon={<PlayCircle className="size-4" />}
                onClick={() => applyMutation.mutate()}
                type="button"
              >
                Apply changes
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                This will restart {coreLabel}. Active connections will briefly drop while the kernel reloads.
              </span>
            </div>
            <div className="h-[60vh] overflow-hidden rounded-md border border-border">
              <DiffEditor
                height="100%"
                language="json"
                modified={content}
                options={{
                  fontFamily: 'JetBrains Mono',
                  fontLigatures: false,
                  fontSize: 12,
                  minimap: { enabled: false },
                  readOnly: true,
                  renderSideBySide: true,
                  scrollBeyondLastLine: false,
                }}
                original={original}
                theme="vs-dark"
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ConfigTab({ core, label }: { core: 'xray' | 'hysteria'; label: string }) {
  return (
    <Link
      activeProps={{ className: 'rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground' }}
      className="rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
      params={{ core }}
      to="/configs/$core"
    >
      {label}
    </Link>
  );
}

function ValidationIndicator({ dirty, state }: { dirty: boolean; state: ValidationState }) {
  if (!dirty) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        No changes
      </div>
    );
  }
  if (state === 'valid') {
    return (
      <div className="inline-flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
        <span className="size-1.5 rounded-full bg-success" />
        Valid
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div className="inline-flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
        <AlertTriangle className="size-3.5" />
        Invalid
      </div>
    );
  }
  return (
    <div className={cn('inline-flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-2.5 py-1 text-xs font-medium text-muted-foreground')}>
      <span className="size-1.5 rounded-full bg-warning" />
      Validate before apply
    </div>
  );
}
