import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Network,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/shared/api/client';
import { Setting } from '@/shared/api/types';

type SettingKey =
  | 'hy2.bandwidth_down'
  | 'hy2.bandwidth_up'
  | 'hy2.domain'
  | 'hy2.masquerade_url'
  | 'hy2.obfs_enabled'
  | 'hy2.obfs_password'
  | 'hy2.port'
  | 'hy2.traffic_secret'
  | 'panel.domain'
  | 'reality.dest'
  | 'reality.private_key'
  | 'reality.public_key'
  | 'reality.short_ids'
  | 'reality.sni'
  | 'subscription.url_prefix'
  | 'vless.port';

type SettingValue = boolean | number | string | string[];
type SettingsDraft = Partial<Record<SettingKey, SettingValue>>;

type RealityPreset = {
  dest: string;
  label: string;
  sni: string;
};

type URLPreset = {
  label: string;
  value: string;
};

type RealityKeyPair = {
  private_key: string;
  public_key: string;
};

const fallbackValues: Record<SettingKey, SettingValue> = {
  'hy2.bandwidth_down': '1 gbps',
  'hy2.bandwidth_up': '1 gbps',
  'hy2.domain': 'panel.example.com',
  'hy2.masquerade_url': 'https://www.bing.com',
  'hy2.obfs_enabled': true,
  'hy2.obfs_password': '',
  'hy2.port': 8443,
  'hy2.traffic_secret': '',
  'panel.domain': 'panel.example.com',
  'reality.dest': 'www.cloudflare.com:443',
  'reality.private_key': '',
  'reality.public_key': '',
  'reality.short_ids': [''],
  'reality.sni': 'www.cloudflare.com',
  'subscription.url_prefix': 'https://panel.example.com',
  'vless.port': 8444,
};

const realityPresets: RealityPreset[] = [
  { label: 'Cloudflare', sni: 'www.cloudflare.com', dest: 'www.cloudflare.com:443' },
  { label: 'Microsoft', sni: 'www.microsoft.com', dest: 'www.microsoft.com:443' },
  { label: 'Apple', sni: 'www.apple.com', dest: 'www.apple.com:443' },
  { label: 'Google', sni: 'www.google.com', dest: 'www.google.com:443' },
];

const masqueradePresets: URLPreset[] = [
  { label: 'Bing', value: 'https://www.bing.com' },
  { label: 'Cloudflare', value: 'https://www.cloudflare.com' },
  { label: 'Wikipedia', value: 'https://www.wikipedia.org' },
];

const vlessPortPresets = [443, 8443, 8444, 2053, 2083];
const hy2PortPresets = [443, 8443, 8444, 2083, 9443];
const bandwidthPresets = ['100 mbps', '500 mbps', '1 gbps'];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [showSecrets, setShowSecrets] = useState(false);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.request<Setting[]>('/settings'),
  });

  const values = useMemo(
    () => createSettingsValues(settings.data ?? [], draft),
    [settings.data, draft],
  );
  const originalValues = useMemo(
    () => createSettingsValues(settings.data ?? [], {}),
    [settings.data],
  );
  const issues = useMemo(() => validateDraft(draft, values), [draft, values]);
  const hasDraft = Object.keys(draft).length > 0;
  const hasIssues = issues.length > 0;
  const currentRealityPreset = findRealityPreset(values.string('reality.sni'), values.string('reality.dest'));
  const currentMasqueradePreset = findURLPreset(values.string('hy2.masquerade_url'), masqueradePresets);

  const save = useMutation({
    mutationFn: () =>
      apiClient.request('/settings', {
        body: JSON.stringify(normalizeDraftForSave(draft)),
        method: 'PATCH',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to update settings');
    },
    onSuccess: async () => {
      toast.success('Settings updated');
      setDraft({});
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const generateReality = useMutation({
    mutationFn: () =>
      apiClient.request<RealityKeyPair>('/settings/reality-keypair', {
        method: 'POST',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to generate Reality keys');
    },
    onSuccess: (keyPair) => {
      setValue('reality.private_key', keyPair.private_key);
      setValue('reality.public_key', keyPair.public_key);
      toast.success('Reality key pair generated');
    },
  });

  function setValue(key: SettingKey, value: SettingValue) {
    setDraft((current) => {
      const next = { ...current };
      if (sameSettingValue(value, originalValues.value(key))) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  function setRealityPreset(label: string) {
    const preset = realityPresets.find((item) => item.label === label);
    if (!preset) return;
    setValue('reality.sni', preset.sni);
    setValue('reality.dest', preset.dest);
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Settings"
        action={
          <>
            <Button
              aria-label={showSecrets ? 'Hide secrets' : 'Show secrets'}
              className="size-10"
              onClick={() => setShowSecrets((value) => !value)}
              size="icon"
              type="button"
            >
              {showSecrets ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </Button>
            {hasDraft ? (
              <>
                <Button disabled={save.isPending} onClick={() => setDraft({})} size="sm" variant="ghost">
                  <RotateCcw />
                  Discard
                </Button>
                <Button disabled={save.isPending || hasIssues} onClick={() => save.mutate()} size="sm">
                  <Save />
                  Save
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="space-y-5 px-page pt-7">
        {settings.isLoading ? (
          <SettingsSkeleton />
        ) : settings.isError ? (
          <SettingsError error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <>
            {hasIssues ? <SettingsIssues issues={issues} /> : null}

            <section className="grid gap-5 xl:grid-cols-2">
              <SettingsSection
                icon={Globe2}
                kicker="Links"
                title="Public endpoints"
              >
                <TextControl
                  label="Panel domain"
                  onChange={(value) => setValue('panel.domain', value)}
                  placeholder="panel.example.com"
                  value={values.string('panel.domain')}
                />
                <TextControl
                  label="Subscription URL"
                  onChange={(value) => setValue('subscription.url_prefix', value)}
                  placeholder="https://panel.example.com"
                  value={values.string('subscription.url_prefix')}
                />
                <TextControl
                  label="Hysteria domain"
                  onChange={(value) => setValue('hy2.domain', value)}
                  placeholder="panel.example.com"
                  value={values.string('hy2.domain')}
                />
              </SettingsSection>

              <SettingsSection
                icon={Network}
                kicker="VLESS"
                title="Reality inbound"
              >
                <PortControl
                  label="VLESS port"
                  max={65535}
                  min={1}
                  onChange={(value) => setValue('vless.port', value)}
                  presets={vlessPortPresets}
                  value={values.number('vless.port')}
                />
                <SelectControl
                  label="Reality target"
                  onChange={(value) => setRealityPreset(value)}
                  options={[
                    ...realityPresets.map((item) => ({ label: item.label, value: item.label })),
                    { label: 'Custom', value: 'Custom' },
                  ]}
                  value={currentRealityPreset?.label ?? 'Custom'}
                />
                <TextControl
                  label="SNI"
                  onChange={(value) => setValue('reality.sni', value)}
                  placeholder="www.cloudflare.com"
                  value={values.string('reality.sni')}
                />
                <TextControl
                  label="Destination"
                  onChange={(value) => setValue('reality.dest', value)}
                  placeholder="www.cloudflare.com:443"
                  value={values.string('reality.dest')}
                />
              </SettingsSection>

              <SettingsSection
                icon={ShieldCheck}
                kicker="Reality"
                title="Keys and short ID"
              >
                <SecretControl
                  label="Private key"
                  generating={generateReality.isPending}
                  onChange={(value) => setValue('reality.private_key', value)}
                  onGenerate={() => generateReality.mutate()}
                  reveal={showSecrets}
                  value={values.string('reality.private_key')}
                />
                <SecretControl
                  label="Public key"
                  generating={generateReality.isPending}
                  onChange={(value) => setValue('reality.public_key', value)}
                  onGenerate={() => generateReality.mutate()}
                  reveal={showSecrets}
                  value={values.string('reality.public_key')}
                />
                <SecretControl
                  label="Short ID"
                  onChange={(value) => setValue('reality.short_ids', [value])}
                  onGenerate={() => setValue('reality.short_ids', [randomHex(8)])}
                  reveal
                  value={firstNonEmpty(values.stringArray('reality.short_ids'))}
                />
              </SettingsSection>

              <SettingsSection
                icon={Radio}
                kicker="Hysteria 2"
                title="Transport"
              >
                <PortControl
                  label="Hysteria port"
                  max={65535}
                  min={1}
                  onChange={(value) => setValue('hy2.port', value)}
                  presets={hy2PortPresets}
                  value={values.number('hy2.port')}
                />
                <BandwidthControl
                  label="Upload bandwidth"
                  onChange={(value) => setValue('hy2.bandwidth_up', value)}
                  presets={bandwidthPresets}
                  value={values.string('hy2.bandwidth_up')}
                />
                <BandwidthControl
                  label="Download bandwidth"
                  onChange={(value) => setValue('hy2.bandwidth_down', value)}
                  presets={bandwidthPresets}
                  value={values.string('hy2.bandwidth_down')}
                />
                <ToggleControl
                  label="Hysteria mode"
                  offLabel="Masquerade"
                  onChange={(value) => setValue('hy2.obfs_enabled', value)}
                  onLabel="Obfs"
                  value={values.bool('hy2.obfs_enabled')}
                />
                {values.bool('hy2.obfs_enabled') ? (
                  <SecretControl
                    label="Obfs password"
                    onChange={(value) => setValue('hy2.obfs_password', value)}
                    onGenerate={() => setValue('hy2.obfs_password', randomSecret(24))}
                    reveal={showSecrets}
                    value={values.string('hy2.obfs_password')}
                  />
                ) : (
                  <>
                    <SelectControl
                      label="Masquerade"
                      onChange={(value) => {
                        if (value !== 'Custom') setValue('hy2.masquerade_url', value);
                      }}
                      options={[
                        ...masqueradePresets.map((item) => ({ label: item.label, value: item.value })),
                        { label: 'Custom', value: 'Custom' },
                      ]}
                      value={currentMasqueradePreset?.value ?? 'Custom'}
                    />
                    <TextControl
                      label="Masquerade URL"
                      onChange={(value) => setValue('hy2.masquerade_url', value)}
                      placeholder="https://www.bing.com"
                      value={values.string('hy2.masquerade_url')}
                    />
                  </>
                )}
                <SecretControl
                  label="Traffic stats secret"
                  onChange={(value) => setValue('hy2.traffic_secret', value)}
                  onGenerate={() => setValue('hy2.traffic_secret', randomSecret(32))}
                  reveal={showSecrets}
                  value={values.string('hy2.traffic_secret')}
                />
              </SettingsSection>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsSection({
  children,
  icon: Icon,
  kicker,
  title,
}: {
  children: ReactNode;
  icon: ComponentType<{ className?: string }>;
  kicker: string;
  title: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-gradient-soft">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="t-label">{kicker}</div>
              <h2 className="truncate text-base font-semibold leading-6 text-foreground">{title}</h2>
            </div>
          </div>
        </div>
        <div className="space-y-5">{children}</div>
      </CardContent>
    </Card>
  );
}

function TextControl({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>
      <Input onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </div>
  );
}

function SecretControl({
  generating,
  label,
  onChange,
  onGenerate,
  reveal,
  value,
}: {
  generating?: boolean;
  label: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  reveal: boolean;
  value: string;
}) {
  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9 pr-11 font-mono"
          onChange={(event) => onChange(event.target.value)}
          type={reveal ? 'text' : 'password'}
          value={value}
        />
        <Button
          aria-label={`Regenerate ${label}`}
          className="absolute inset-y-0 right-0 h-full w-10 rounded-l-none"
          disabled={generating}
          onClick={onGenerate}
          size="icon"
          type="button"
          variant="ghost"
        >
          <RefreshCw className={cn('size-4', generating && 'animate-spin')} />
        </Button>
      </div>
    </div>
  );
}

function PortControl({
  label,
  max,
  min,
  onChange,
  presets,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  presets: number[];
  value: number;
}) {
  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((port) => (
          <Button
            className="h-8 px-3 text-xs"
            key={port}
            onClick={() => onChange(port)}
            size="sm"
            type="button"
            variant={value === port ? 'default' : 'secondary'}
          >
            {port}
          </Button>
        ))}
        <Input
          className="h-8 w-28 shrink-0 font-mono text-xs"
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
          step={1}
          type="number"
          value={Number.isFinite(value) ? String(value) : ''}
        />
      </div>
    </div>
  );
}

function BandwidthControl({
  label,
  onChange,
  presets,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  presets: string[];
  value: string;
}) {
  const normalizedValue = value.trim().toLowerCase();

  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <Button
            className="h-8 px-3 text-xs"
            key={preset}
            onClick={() => onChange(preset)}
            size="sm"
            type="button"
            variant={normalizedValue === preset ? 'default' : 'secondary'}
          >
            {preset}
          </Button>
        ))}
        <Input
          className="h-8 w-32 shrink-0 font-mono text-xs"
          onChange={(event) => onChange(event.target.value)}
          placeholder="1 gbps"
          value={value}
        />
      </div>
    </div>
  );
}

function ToggleControl({
  label,
  offLabel,
  onChange,
  onLabel,
  value,
}: {
  label: string;
  offLabel: string;
  onChange: (value: boolean) => void;
  onLabel: string;
  value: boolean;
}) {
  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/45 p-1">
        <Button onClick={() => onChange(true)} size="sm" type="button" variant={value ? 'default' : 'ghost'}>
          {onLabel}
        </Button>
        <Button onClick={() => onChange(false)} size="sm" type="button" variant={!value ? 'default' : 'ghost'}>
          {offLabel}
        </Button>
      </div>
    </div>
  );
}

function SelectControl({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="space-y-2.5">
      <Label>{label}</Label>
      <select
        className={cn(
          'h-9 w-full rounded-md border border-transparent bg-muted/65 px-3 text-sm text-foreground shadow-xs outline-none transition-colors',
          'hover:bg-muted focus-visible:border-ring/45 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/35',
        )}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SettingsIssues({ issues }: { issues: string[] }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" />
        Settings need attention
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="space-y-5 p-5">
            <Skeleton className="h-10 w-52" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-9 w-36" />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function SettingsError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <div className="text-base font-semibold text-foreground">Unable to load settings</div>
        <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(error)}</p>
        <Button onClick={onRetry} size="sm" variant="secondary">
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function createSettingsValues(items: Setting[], draft: SettingsDraft) {
  const map = new Map(items.map((item) => [item.key, item.value]));

  function value(key: SettingKey): SettingValue {
    return draft[key] ?? coerceSettingValue(key, map.get(key));
  }

  return {
    bool: (key: SettingKey) => {
      const raw = value(key);
      return typeof raw === 'boolean' ? raw : Boolean(fallbackValues[key]);
    },
    number: (key: SettingKey) => {
      const raw = value(key);
      return typeof raw === 'number' ? raw : Number(fallbackValues[key]);
    },
    string: (key: SettingKey) => {
      const raw = value(key);
      return typeof raw === 'string' ? raw : String(fallbackValues[key] ?? '');
    },
    stringArray: (key: SettingKey) => {
      const raw = value(key);
      return Array.isArray(raw) ? raw.map(String) : asStringArray(fallbackValues[key]);
    },
    value,
  };
}

function coerceSettingValue(key: SettingKey, value: unknown): SettingValue {
  const fallback = fallbackValues[key];
  if (Array.isArray(fallback)) return Array.isArray(value) ? value.map(String) : fallback;
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : fallback;
  if (typeof fallback === 'number') return typeof value === 'number' ? value : fallback;
  return typeof value === 'string' ? value : String(fallback);
}

function validateDraft(draft: SettingsDraft, values: ReturnType<typeof createSettingsValues>) {
  const issues: string[] = [];
  for (const key of Object.keys(draft) as SettingKey[]) {
    if ((key.endsWith('.port') || key === 'vless.port') && !validPort(values.number(key))) {
      issues.push(`${settingLabel(key)} must be between 1 and 65535.`);
    }
    if ((key.includes('domain') || key === 'reality.sni') && values.string(key).trim() === '') {
      issues.push(`${settingLabel(key)} cannot be empty.`);
    }
    if ((key === 'subscription.url_prefix' || key === 'hy2.masquerade_url') && !validURL(values.string(key))) {
      issues.push(`${settingLabel(key)} must be a valid http or https URL.`);
    }
    if (key === 'reality.dest' && !validHostPort(values.string(key))) {
      issues.push('Reality / Dest must be a host:port value.');
    }
    if (key === 'reality.short_ids' && !values.stringArray(key).every(validRealityShortID)) {
      issues.push('Reality / Short Ids must contain empty or even-length hex values up to 16 characters.');
    }
    if ((key === 'hy2.bandwidth_up' || key === 'hy2.bandwidth_down') && !validBandwidth(values.string(key))) {
      issues.push(`${settingLabel(key)} must use mbps or gbps.`);
    }
  }
  if (draft['hy2.obfs_enabled'] === true || draft['hy2.obfs_password'] !== undefined) {
    if (values.bool('hy2.obfs_enabled') && values.string('hy2.obfs_password').trim() === '') {
      issues.push('Obfs password is required when Hysteria obfuscation is enabled.');
    }
  }
  if (draft['reality.private_key'] !== undefined || draft['reality.public_key'] !== undefined) {
    if (values.string('reality.private_key').trim() === '' || values.string('reality.public_key').trim() === '') {
      issues.push('Reality private and public keys must be saved together.');
    }
  }
  return issues;
}

function normalizeDraftForSave(draft: SettingsDraft): SettingsDraft {
  const normalized: SettingsDraft = {};
  for (const [key, value] of Object.entries(draft) as Array<[SettingKey, SettingValue]>) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      normalized[key] = key === 'subscription.url_prefix' ? trimmed.replace(/\/+$/, '') : trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => item.trim());
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function settingLabel(key: SettingKey): string {
  return key
    .split('.')
    .map((part) => part.split('_').join(' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}

function sameSettingValue(left: SettingValue, right: SettingValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asStringArray(value: SettingValue): string[] {
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function firstNonEmpty(values: string[]): string {
  return values.find((value) => value.trim() !== '') ?? '';
}

function findRealityPreset(sni: string, dest: string): RealityPreset | undefined {
  return realityPresets.find((preset) => preset.sni === sni && preset.dest === dest);
}

function findURLPreset(value: string, presets: URLPreset[]): URLPreset | undefined {
  return presets.find((preset) => preset.value === value);
}

function validPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function validURL(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validHostPort(value: string): boolean {
  try {
    const parsed = new URL(`tcp://${value.trim()}`);
    return parsed.hostname !== '' && parsed.pathname === '' && validPort(Number(parsed.port));
  } catch {
    return false;
  }
}

function validRealityShortID(value: string): boolean {
  return value.length % 2 === 0 && /^[0-9a-fA-F]{0,16}$/.test(value);
}

function validBandwidth(value: string): boolean {
  return /^\d+(?:\.\d+)?\s*(g|gbps|m|mbps)$/i.test(value.trim());
}

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomSecret(bytes: number): string {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = '';
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Request failed';
}
