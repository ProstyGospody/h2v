import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, Eye, EyeOff, KeyRound, RefreshCw, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { apiClient, ApiError } from '@/shared/api/client';
import type { TelegramProxyInfo } from '@/shared/api/types';

type TelegramForm = {
  enabled: boolean;
  fallback_addr: string;
  host: string;
  mask_domain: string;
  port: number;
  secret: string;
};

const fallbackForm: TelegramForm = {
  enabled: true,
  fallback_addr: 'www.cloudflare.com:443',
  host: 'panel.example.com',
  mask_domain: 'www.cloudflare.com',
  port: 9443,
  secret: '',
};

export function TelegramProxyPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TelegramForm>(fallbackForm);
  const [showSecret, setShowSecret] = useState(false);

  const proxy = useQuery({
    queryKey: ['telegram-proxy'],
    queryFn: () => apiClient.request<TelegramProxyInfo>('/telegram-proxy'),
  });

  useEffect(() => {
    if (!proxy.data) return;
    setForm({
      enabled: proxy.data.enabled,
      fallback_addr: proxy.data.fallback_addr,
      host: proxy.data.host,
      mask_domain: proxy.data.mask_domain,
      port: proxy.data.port,
      secret: proxy.data.secret,
    });
  }, [proxy.data]);

  const issues = useMemo(() => validateTelegramForm(form), [form]);
  const isDirty = useMemo(() => {
    if (!proxy.data) return false;
    return (
      form.enabled !== proxy.data.enabled ||
      form.fallback_addr !== proxy.data.fallback_addr ||
      form.host !== proxy.data.host ||
      form.mask_domain !== proxy.data.mask_domain ||
      form.port !== proxy.data.port ||
      form.secret !== proxy.data.secret
    );
  }, [form, proxy.data]);

  const save = useMutation({
    mutationFn: () =>
      apiClient.request<TelegramProxyInfo>('/telegram-proxy', {
        body: JSON.stringify({
          'telegram.enabled': form.enabled,
          'telegram.fallback': form.fallback_addr.trim(),
          'telegram.host': form.host.trim(),
          'telegram.mask_domain': form.mask_domain.trim(),
          'telegram.port': form.port,
          'telegram.secret': form.secret.trim(),
        }),
        method: 'PATCH',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to update Telegram proxy');
    },
    onSuccess: async () => {
      toast.success('Telegram proxy updated');
      await queryClient.invalidateQueries({ queryKey: ['telegram-proxy'] });
    },
  });

  const regenerate = useMutation({
    mutationFn: () =>
      apiClient.request<TelegramProxyInfo>('/telegram-proxy/secret', {
        method: 'POST',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to regenerate Telegram secret');
    },
    onSuccess: async () => {
      toast.success('Telegram secret regenerated');
      await queryClient.invalidateQueries({ queryKey: ['telegram-proxy'] });
    },
  });

  async function copyLink() {
    if (!proxy.data?.link) return;
    await navigator.clipboard.writeText(proxy.data.link);
    toast.success('Telegram link copied');
  }

  function setValue<K extends keyof TelegramForm>(key: K, value: TelegramForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="min-h-screen bg-app-background px-4 py-6 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={!proxy.data?.link} onClick={copyLink} type="button" variant="secondary">
                <Copy className="size-4" />
                Copy
              </Button>
              <Button
                disabled={save.isPending || !isDirty || issues.length > 0}
                onClick={() => save.mutate()}
                type="button"
              >
                <Save className="size-4" />
                Save
              </Button>
            </div>
          }
          description="External MTProxy-compatible entrypoint powered by Telemt."
          title="Telegram Proxy"
        />

        {proxy.isLoading ? (
          <TelegramSkeleton />
        ) : proxy.isError ? (
          <Card className="border-0">
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <div className="text-base font-semibold text-foreground">Unable to load Telegram proxy</div>
              <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(proxy.error)}</p>
              <Button onClick={() => proxy.refetch()} size="sm" variant="secondary">
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
            <Card className="border-0">
              <CardContent className="space-y-6 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="t-label">Endpoint</div>
                    <h2 className="mt-1 font-display text-xl font-semibold text-foreground">MTProxy Fake TLS</h2>
                  </div>
                  <span className="rounded-md bg-muted/55 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {form.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <label className="flex items-center gap-3 rounded-md bg-muted/35 px-3 py-2 text-sm text-foreground">
                  <input
                    checked={form.enabled}
                    className="size-4 accent-[var(--accent)]"
                    onChange={(event) => setValue('enabled', event.target.checked)}
                    type="checkbox"
                  />
                  Enable Telegram proxy
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label="Public host"
                    onChange={(value) => setValue('host', value)}
                    placeholder="tg.example.com"
                    value={form.host}
                  />
                  <NumberField
                    label="Port"
                    onChange={(value) => setValue('port', value)}
                    value={form.port}
                  />
                  <TextField
                    label="Mask domain"
                    onChange={(value) => setValue('mask_domain', value)}
                    placeholder="www.cloudflare.com"
                    value={form.mask_domain}
                  />
                  <TextField
                    label="Fallback"
                    onChange={(value) => setValue('fallback_addr', value)}
                    placeholder="www.cloudflare.com:443"
                    value={form.fallback_addr}
                  />
                </div>

                <div className="space-y-[13px]">
                  <Label>Secret</Label>
                  <div className="flex gap-2">
                    <Input
                      className="font-mono"
                      onChange={(event) => setValue('secret', event.target.value)}
                      spellCheck={false}
                      type={showSecret ? 'text' : 'password'}
                      value={form.secret}
                    />
                    <Button
                      aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                      className="size-9 shrink-0"
                      onClick={() => setShowSecret((value) => !value)}
                      size="icon"
                      type="button"
                      variant="secondary"
                    >
                      {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                    <Button
                      disabled={regenerate.isPending}
                      onClick={() => regenerate.mutate()}
                      type="button"
                      variant="secondary"
                    >
                      {regenerate.isPending ? <RefreshCw className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                      Generate
                    </Button>
                  </div>
                </div>

                {issues.length > 0 ? <TelegramIssues issues={issues} /> : null}
              </CardContent>
            </Card>

            <Card className="border-0">
              <CardContent className="space-y-5 p-6">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-md bg-accent-gradient-soft">
                    <Send className="size-5 text-foreground" />
                  </div>
                  <div>
                    <div className="t-label">Telegram</div>
                    <div className="font-display text-lg font-semibold text-foreground">Ready link</div>
                  </div>
                </div>
                <div className="rounded-md bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                  {proxy.data?.link ? 'Generated and ready to copy' : 'Generate a valid secret to create the link'}
                </div>
                <Button className="w-full" disabled={!proxy.data?.link} onClick={copyLink} type="button">
                  <Copy className="size-4" />
                  Copy
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="space-y-[13px]">
      <Label>{label}</Label>
      <Input onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </div>
  );
}

function NumberField({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <div className="space-y-[13px]">
      <Label>{label}</Label>
      <Input
        inputMode="numeric"
        max={65535}
        min={1}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={Number.isFinite(value) ? value : ''}
      />
    </div>
  );
}

function TelegramIssues({ issues }: { issues: string[] }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" />
        Telegram proxy needs attention
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}

function TelegramSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
      <Card className="border-0">
        <CardContent className="space-y-5 p-6">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-44" />
        </CardContent>
      </Card>
      <Card className="border-0">
        <CardContent className="space-y-5 p-6">
          <Skeleton className="h-12 w-44" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

function validateTelegramForm(form: TelegramForm): string[] {
  const issues: string[] = [];
  if (form.enabled && form.host.trim() === '') {
    issues.push('Public host cannot be empty.');
  }
  if (form.port < 1 || form.port > 65535 || !Number.isFinite(form.port)) {
    issues.push('Port must be between 1 and 65535.');
  }
  if (form.enabled && !/^[0-9a-fA-F]{32}$/.test(form.secret.trim())) {
    issues.push('Secret must be 32 hex characters.');
  }
  if (form.enabled && form.mask_domain.trim() === '') {
    issues.push('Mask domain cannot be empty.');
  }
  if (form.enabled && !/^[^:]+:\d+$/.test(form.fallback_addr.trim())) {
    issues.push('Fallback must be a host:port value.');
  }
  return issues;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
