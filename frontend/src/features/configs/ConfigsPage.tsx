import { useEffect, useMemo, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { apiClient, ApiError } from '@/shared/api/client';

type ValidationState = 'idle' | 'valid' | 'invalid';
type Core = 'xray' | 'hysteria';

function asCore(value: string): Core | null {
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
  const tabsValue: Core = core ?? 'xray';

  const [draft, setDraft] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationState>('idle');
  const [diffOpen, setDiffOpen] = useState(false);

  const config = useQuery({
    enabled: Boolean(core),
    queryKey: ['configs', core],
    queryFn: () => apiClient.request<{ content: string }>(`/configs/${core}`),
  });

  useEffect(() => {
    setValidation('idle');
    setDiffOpen(false);
    setDraft(null);
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
      setValidation('idle');
      setDiffOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  const history = useQuery({
    enabled: Boolean(core),
    queryKey: ['configs', core, 'history'],
    queryFn: () =>
      apiClient.request<Array<{ id: number; applied_at: string; note: string }>>(
        `/configs/${core}/history`,
      ),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiClient.request(`/configs/${core}/restore/${id}`, { method: 'POST' }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to restore version');
    },
    onSuccess: async () => {
      toast.success('Previous version restored');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['configs', core] }),
        queryClient.invalidateQueries({ queryKey: ['configs', core, 'history'] }),
      ]);
    },
  });

  if (!core) {
    return (
      <div className="px-5 pb-10 pt-8 sm:px-8">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="text-base font-semibold">Unknown config core</div>
            <p className="text-sm text-muted-foreground">Choose one of the available cores to continue.</p>
            <div className="flex gap-2">
              <Button onClick={() => navigate({ to: '/configs/$core', params: { core: 'xray' } })} size="sm">
                Xray
              </Button>
              <Button
                onClick={() => navigate({ to: '/configs/$core', params: { core: 'hysteria' } })}
                size="sm"
                variant="secondary"
              >
                Hysteria
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
            <Tabs
              onValueChange={(value) => navigate({ to: '/configs/$core', params: { core: value as Core } })}
              value={tabsValue}
            >
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
              {!dirty ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/60" />
                  No changes
                </span>
              ) : validation === 'valid' ? (
                <span className="flex items-center gap-1.5 rounded-md bg-success/12 px-2 py-0.5 text-xs text-success">
                  <span className="size-1.5 rounded-full bg-success" />
                  Valid
                </span>
              ) : validation === 'invalid' ? (
                <span className="flex items-center gap-1.5 rounded-md bg-destructive/12 px-2 py-0.5 text-xs text-destructive">
                  <AlertTriangle className="size-3" />
                  Invalid
                </span>
              ) : (
                <span className="flex items-center gap-1.5 rounded-md bg-warning/12 px-2 py-0.5 text-xs text-warning">
                  <span className="size-1.5 rounded-full bg-warning" />
                  Validate before apply
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {config.isLoading ? (
              <Skeleton className="h-[70vh] w-full rounded-none" />
            ) : config.isError ? (
              <div className="flex h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="text-base font-semibold">Unable to load configuration</div>
                <p className="max-w-xl text-sm text-muted-foreground">
                  {config.error instanceof ApiError ? config.error.message : 'Request failed'}
                </p>
                <Button onClick={() => config.refetch()} size="sm" variant="secondary">
                  Retry
                </Button>
              </div>
            ) : (
              <Textarea
                className="h-[70vh] resize-none rounded-none border-0 bg-transparent px-5 py-4 font-mono text-xs leading-5"
                onChange={(event) => {
                  setDraft(event.target.value);
                  setValidation('idle');
                }}
                spellCheck={false}
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
              Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)
            ) : history.isError ? (
              <div className="py-6 text-center text-xs text-destructive">Failed to load history</div>
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
              <div className="py-6 text-center text-xs text-muted-foreground">No applied versions yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog onOpenChange={setDiffOpen} open={diffOpen}>
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Apply changes</DialogTitle>
            <DialogDescription>Review the diff before restarting {coreLabel}.</DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>This will restart {coreLabel}. Active connections will briefly drop.</span>
          </div>

          <div className="grid h-[60vh] gap-3 overflow-hidden md:grid-cols-2">
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

function DiffPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border">
      <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{label}</div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-5">{value}</pre>
    </div>
  );
}
