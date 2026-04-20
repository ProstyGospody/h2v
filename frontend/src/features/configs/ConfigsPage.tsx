import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient, ApiError } from '@/shared/api/client';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  SecondaryButton,
  Skeleton,
} from '@/shared/ui/primitives';

type ValidationState = 'idle' | 'valid' | 'invalid';

export function ConfigsPage() {
  const { core } = useParams({ from: '/app/configs/$core' });
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string>('');
  const [validationState, setValidationState] = useState<ValidationState>('idle');

  const config = useQuery({
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<{ content: string }>(`/configs/${core}`),
  });

  useEffect(() => {
    setValidationState('idle');
  }, [core]);

  useEffect(() => {
    if (config.data?.content !== undefined) {
      setDraft(config.data.content);
    }
  }, [config.data?.content]);

  const content = useMemo(() => draft ?? config.data?.content ?? '', [draft, config.data?.content]);
  const dirty = Boolean(config.data && content !== config.data.content);

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

  return (
    <div className="pb-8">
      <PageHeader
        title={`${coreLabel} config`}
        subtitle="Validate changes before apply. Writing a new runtime config restarts the selected core."
        action={
          <>
            <SecondaryButton
              onClick={() => {
                setDraft(config.data?.content ?? '');
                setValidationState('idle');
              }}
              type="button"
            >
              Reset
            </SecondaryButton>
            <SecondaryButton busy={validateMutation.isPending} onClick={() => validateMutation.mutate()} type="button">
              Validate
            </SecondaryButton>
            <Button busy={applyMutation.isPending} disabled={!dirty} onClick={() => applyMutation.mutate()} type="button">
              Apply
            </Button>
          </>
        }
      />

      <div className="px-5 pt-5 sm:px-6">
        <div className="flex gap-2 overflow-x-auto">
          <ConfigTab core="xray" label="Xray" />
          <ConfigTab core="hysteria" label="Hysteria" />
        </div>
      </div>

      <div className="px-5 pt-5 sm:px-6 md:hidden">
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="t-h2">Desktop required</div>
            <p className="text-sm text-muted-foreground">Configuration editing is intentionally desktop-only. Use a wider viewport to validate and apply changes safely.</p>
          </CardContent>
        </Card>
      </div>

      <div className="hidden gap-6 px-5 pt-5 sm:px-6 md:grid xl:grid-cols-[1.75fr_360px]">
        <Card className="overflow-hidden">
          <CardHeader className="gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>{coreLabel} editor</CardTitle>
                <CardDescription>JetBrains Mono, runtime JSON, and a single apply path.</CardDescription>
              </div>
              <ValidationIndicator dirty={dirty} state={validationState} />
            </div>
            <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-3 text-sm text-warning">
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
            <CardTitle>Recent history</CardTitle>
            <CardDescription>Restore a previous version if a runtime change needs to be rolled back.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {history.isLoading
              ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)
              : history.data?.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border bg-surface-elevated p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">Version #{entry.id}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{new Date(entry.applied_at).toLocaleString()}</div>
                      </div>
                      <SecondaryButton
                        busy={restoreMutation.isPending && restoreMutation.variables === entry.id}
                        onClick={() => restoreMutation.mutate(entry.id)}
                        size="sm"
                        type="button"
                      >
                        Restore
                      </SecondaryButton>
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">{entry.note || 'Applied from panel'}</div>
                  </div>
                ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ConfigTab({ core, label }: { core: 'xray' | 'hysteria'; label: string }) {
  return (
    <Link
      activeProps={{ className: 'rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-foreground' }}
      className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-muted-foreground"
      params={{ core }}
      to="/configs/$core"
    >
      {label}
    </Link>
  );
}

function ValidationIndicator({ dirty, state }: { dirty: boolean; state: ValidationState }) {
  if (!dirty) {
    return <div className="text-xs text-muted-foreground">No changes</div>;
  }
  if (state === 'valid') {
    return (
      <div className="inline-flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-3 py-2 text-xs font-medium text-success">
        <CheckCircle2 className="size-4" />
        Valid
      </div>
    );
  }
  if (state === 'invalid') {
    return (
      <div className="inline-flex items-center gap-2 rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
        <AlertTriangle className="size-4" />
        Fix validation errors
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-2 text-xs font-medium text-muted-foreground">
      <RotateCcw className="size-4" />
      Validate before apply
    </div>
  );
}
