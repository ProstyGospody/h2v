import { useEffect, useMemo, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, History, PlayCircle, RotateCcw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
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

type ValidationState = 'idle' | 'valid' | 'invalid';

export function ConfigsPage() {
  const { core } = useParams({ from: '/app/configs/$core' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string>('');
  const [validation, setValidation] = useState<ValidationState>('idle');
  const [diffOpen, setDiffOpen] = useState(false);

  const config = useQuery({
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<{ content: string }>(`/configs/${core}`),
  });

  useEffect(() => {
    setValidation('idle');
    setDiffOpen(false);
  }, [core]);

  useEffect(() => {
    if (config.data?.content !== undefined) setDraft(config.data.content);
  }, [config.data?.content]);

  const content = useMemo(() => draft ?? config.data?.content ?? '', [draft, config.data?.content]);
  const original = config.data?.content ?? '';
  const dirty = Boolean(config.data && content !== original);

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
    onSuccess: async () => {
      toast.success('Configuration applied');
      setValidation('idle');
      setDiffOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  const history = useQuery({
    queryKey: ['configs', core, 'history'],
    queryFn: () =>
      apiClient.request<Array<{ id: number; applied_at: string; note: string }>>(
        `/configs/${core}/history`,
      ),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.request(`/configs/${core}/restore/${id}`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Previous version restored');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  const coreLabel = core === 'hysteria' ? 'Hysteria' : 'Xray';
  const readyToApply = dirty && validation === 'valid';

  return (
    <div className="pb-10">
      <header className="px-5 pb-2 pt-8 sm:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="t-label">Configs</div>
            <h1 className="text-[26px] font-semibold leading-none tracking-[-0.01em] text-foreground">
              {coreLabel}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs onValueChange={(v) => navigate({ to: '/configs/$core', params: { core: v } })} value={core}>
              <TabsList>
                <TabsTrigger value="xray">Xray</TabsTrigger>
                <TabsTrigger value="hysteria">Hysteria</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              disabled={!dirty}
              onClick={() => {
                setDraft(original);
                setValidation('idle');
              }}
              size="sm"
              variant="ghost"
            >
              <RotateCcw />
              Reset
            </Button>
            <Button
              disabled={!dirty || validateMutation.isPending}
              onClick={() => validateMutation.mutate()}
              size="sm"
              variant="secondary"
            >
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

      <div className="px-5 pt-5 sm:px-8 md:hidden">
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="text-base font-semibold">Desktop required</div>
            <p className="text-sm text-muted-foreground">
              Use a wider viewport to validate and apply config changes.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="hidden gap-4 px-5 pt-5 sm:px-8 md:grid xl:grid-cols-[1.75fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Editor</CardTitle>
              <ValidationIndicator dirty={dirty} state={validation} />
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {config.isLoading ? (
              <Skeleton className="h-[70vh] w-full rounded-none" />
            ) : (
              <Editor
                height="70vh"
                language="json"
                onChange={(v) => {
                  setDraft(v ?? '');
                  setValidation('idle');
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
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {history.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
            ) : history.data?.length ? (
              history.data.map((entry) => (
                <div
                  className="flex items-center justify-between rounded-md px-2 py-2 transition hover:bg-accent"
                  key={entry.id}
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-foreground">v{entry.id}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(entry.applied_at).toLocaleString()}
                    </div>
                  </div>
                  <Button
                    disabled={restoreMutation.isPending && restoreMutation.variables === entry.id}
                    onClick={() => restoreMutation.mutate(entry.id)}
                    size="sm"
                    variant="ghost"
                  >
                    <Undo2 />
                    Restore
                  </Button>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No applied versions yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog onOpenChange={setDiffOpen} open={diffOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Apply changes</DialogTitle>
            <DialogDescription>Review the diff before restarting {coreLabel}.</DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>This will restart {coreLabel}. Active connections will briefly drop.</span>
          </div>

          <div className="h-[60vh] overflow-hidden rounded-md">
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

function ValidationIndicator({ dirty, state }: { dirty: boolean; state: ValidationState }) {
  if (!dirty) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        No changes
      </span>
    );
  }
  if (state === 'valid') {
    return (
      <span className="flex items-center gap-1.5 rounded-md bg-success/12 px-2 py-0.5 text-xs text-success">
        <span className="size-1.5 rounded-full bg-success" />
        Valid
      </span>
    );
  }
  if (state === 'invalid') {
    return (
      <span className="flex items-center gap-1.5 rounded-md bg-destructive/12 px-2 py-0.5 text-xs text-destructive">
        <AlertTriangle className="size-3" />
        Invalid
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-1.5 rounded-md bg-warning/12 px-2 py-0.5 text-xs text-warning')}>
      <span className="size-1.5 rounded-full bg-warning" />
      Validate before apply
    </span>
  );
}
