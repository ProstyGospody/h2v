import { useMemo, useRef, useState, type ChangeEvent, type ComponentType, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';
import { apiClient, ApiError } from '@/shared/api/client';
import { useI18n, type Translate } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';
import type { Setting } from '@/shared/api/types';

type SettingKey =
  | 'hy2.bandwidth_down'
  | 'hy2.bandwidth_up'
  | 'hy2.domain'
  | 'hy2.masquerade_url'
  | 'hy2.obfs_enabled'
  | 'hy2.obfs_password'
  | 'hy2.port'
  | 'hy2.traffic_secret'
  | 'reality.dest'
  | 'reality.private_key'
  | 'reality.public_key'
  | 'reality.short_ids'
  | 'reality.sni'
  | 'vless.port';

type SettingValue = boolean | number | string | string[];
type SettingsDraft = Partial<Record<SettingKey, SettingValue>>;
type PortKey = 'hy2.port' | 'vless.port';

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

type H2VBackup = Record<string, unknown>;

type BackupImportSummary = {
  settings: number;
  users: number;
  configs: number;
};

const fallbackValues: Record<SettingKey, SettingValue> = {
  'hy2.bandwidth_down': '1 gbps',
  'hy2.bandwidth_up': '1 gbps',
  'hy2.domain': 'h2v.example.com',
  'hy2.masquerade_url': 'https://www.google.com',
  'hy2.obfs_enabled': true,
  'hy2.obfs_password': '',
  'hy2.port': 8443,
  'hy2.traffic_secret': '',
  'reality.dest': 'www.google.com:443',
  'reality.private_key': '',
  'reality.public_key': '',
  'reality.short_ids': ['a1b2c3d4e5f60718'],
  'reality.sni': 'www.google.com',
  'vless.port': 8444,
};

const settingLabelKeys: Record<SettingKey, TranslationKey> = {
  'hy2.bandwidth_down': 'setting.hy2.bandwidth_down',
  'hy2.bandwidth_up': 'setting.hy2.bandwidth_up',
  'hy2.domain': 'setting.hy2.domain',
  'hy2.masquerade_url': 'setting.hy2.masquerade_url',
  'hy2.obfs_enabled': 'setting.hy2.obfs_enabled',
  'hy2.obfs_password': 'setting.hy2.obfs_password',
  'hy2.port': 'setting.hy2.port',
  'hy2.traffic_secret': 'setting.hy2.traffic_secret',
  'reality.dest': 'setting.reality.dest',
  'reality.private_key': 'setting.reality.private_key',
  'reality.public_key': 'setting.reality.public_key',
  'reality.short_ids': 'setting.reality.short_ids',
  'reality.sni': 'setting.reality.sni',
  'vless.port': 'setting.vless.port',
};

const realityPresets: RealityPreset[] = [
  { label: 'Google', sni: 'www.google.com', dest: 'www.google.com:443' },
  { label: 'Microsoft', sni: 'www.microsoft.com', dest: 'www.microsoft.com:443' },
  { label: 'Apple', sni: 'www.apple.com', dest: 'www.apple.com:443' },
];

const masqueradePresets: URLPreset[] = [
  { label: 'Google', value: 'https://www.google.com' },
  { label: 'Bing', value: 'https://www.bing.com' },
  { label: 'Wikipedia', value: 'https://www.wikipedia.org' },
];

const vlessPortPresets = [443, 8443, 8444, 2053, 2083];
const hy2PortPresets = [443, 8443, 8444, 2083, 9443];
const bandwidthPresets = ['100 mbps', '500 mbps', '1 gbps', '10 gbps'];
const portDefinitions: Array<{ key: PortKey; presets: number[]; protocol: 'tcp' | 'udp' }> = [
  { key: 'vless.port', presets: vlessPortPresets, protocol: 'tcp' },
  { key: 'hy2.port', presets: hy2PortPresets, protocol: 'udp' },
];

const settingFieldClassName =
  'bg-accent-gradient-soft hover:bg-[image:var(--gradient-accent-soft)] focus-visible:bg-[image:var(--gradient-accent-soft)]';
const settingChoiceClassName =
  'bg-accent-gradient-soft shadow-none hover:bg-[image:var(--gradient-accent-soft)]';

type SettingsUpdateResult = {
  updated: boolean;
};

type PortCheckItem = {
  key: PortKey;
  port: number;
  protocol: 'tcp' | 'udp';
};

type PortCheckResult = PortCheckItem & {
  available: boolean;
  reason?: string;
};

export function SettingsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SettingsDraft>({});
  const [showSecrets, setShowSecrets] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

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
  const issues = useMemo(() => validateDraft(draft, values, t), [draft, t, values]);
  const portCheckItems = useMemo(() => createPortCheckItems(values), [values]);
  const portAvailability = useQuery({
    enabled: settings.isSuccess && portCheckItems.length > 0,
    queryFn: () =>
      apiClient.request<PortCheckResult[]>('/settings/ports/check', {
        body: JSON.stringify({ ports: portCheckItems }),
        method: 'POST',
      }),
    queryKey: ['settings-port-checks', portCheckItems],
  });
  const portIssues = useMemo(
    () => createPortIssues(draft, values, originalValues, portAvailability.data ?? [], portAvailability.isError, t),
    [draft, originalValues, portAvailability.data, portAvailability.isError, t, values],
  );
  const allIssues = useMemo(() => [...issues, ...portIssues], [issues, portIssues]);
  const hasDraft = Object.keys(draft).length > 0;
  const isCheckingPorts = portAvailability.isFetching && hasChangedPort(draft, values, originalValues);
  const hasIssues = allIssues.length > 0;
  const currentRealityPreset = findRealityPreset(values.string('reality.sni'), values.string('reality.dest'));
  const currentMasqueradePreset = findURLPreset(values.string('hy2.masquerade_url'), masqueradePresets);

  const save = useMutation({
    mutationFn: () =>
      apiClient.request<SettingsUpdateResult>('/settings', {
        body: JSON.stringify(normalizeDraftForSave(draft)),
        method: 'PATCH',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('settings.unableUpdateSettings'));
    },
    onSuccess: async () => {
      toast.success(t('settings.settingsUpdated'));
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
      toast.error(error instanceof ApiError ? error.message : t('settings.unableGenerateReality'));
    },
    onSuccess: (keyPair) => {
      setValue('reality.private_key', keyPair.private_key);
      setValue('reality.public_key', keyPair.public_key);
      toast.success(t('settings.realityGenerated'));
    },
  });

  const exportBackup = useMutation({
    mutationFn: () => apiClient.request<H2VBackup>('/backup/export'),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('settings.unableExportBackup'));
    },
    onSuccess: (backup) => {
      downloadBackupFile(backup);
      toast.success(t('settings.backupSaved'));
    },
  });

  const importBackup = useMutation({
    mutationFn: (backup: H2VBackup) =>
      apiClient.request<BackupImportSummary>('/backup/import', {
        body: JSON.stringify(backup),
        method: 'POST',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('settings.unableImportBackup'));
    },
    onSuccess: async () => {
      toast.success(t('settings.backupRestored'));
      setDraft({});
      await queryClient.invalidateQueries();
    },
  });

  const updateGeodata = useMutation({
    mutationFn: () =>
      apiClient.request<{ updated: boolean }>('/geodata/update', {
        method: 'POST',
      }),
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : t('settings.unableUpdateGeo'));
    },
    onSuccess: () => {
      toast.success(t('settings.geoUpdated'));
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

  async function handleBackupUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!window.confirm(t('settings.restoreConfirm'))) return;

    try {
      const payload = JSON.parse(await file.text()) as H2VBackup;
      importBackup.mutate(payload);
    } catch {
      toast.error(t('settings.backupInvalidJson'));
    }
  }

  return (
    <div className="pb-10">
      <PageHeader
        title={t('settings.title')}
        action={
          <>
            <Button
              aria-label={showSecrets ? t('settings.hideSecrets') : t('settings.showSecrets')}
              className="size-10"
              onClick={() => setShowSecrets((value) => !value)}
              size="icon"
              type="button"
            >
              {showSecrets ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </Button>
            <Button
              className="h-10"
              disabled={exportBackup.isPending}
              onClick={() => exportBackup.mutate()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Download />
              {t('settings.saveBackup')}
            </Button>
            <Button
              className="h-10"
              disabled={importBackup.isPending}
              onClick={() => backupInputRef.current?.click()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Upload />
              {t('settings.restoreBackup')}
            </Button>
            <input
              ref={backupInputRef}
              accept="application/json,.json"
              className="hidden"
              onChange={handleBackupUpload}
              type="file"
            />
            <Button
              className="h-10"
              disabled={updateGeodata.isPending}
              onClick={() => updateGeodata.mutate()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <RefreshCw className={cn(updateGeodata.isPending && 'animate-spin')} />
              {t('settings.updateGeo')}
            </Button>
            {hasDraft ? (
              <>
                <Button
                  className="h-10"
                  disabled={save.isPending}
                  onClick={() => setDraft({})}
                  size="sm"
                  variant="ghost"
                >
                  <RotateCcw />
                  {t('common.discard')}
                </Button>
                <Button
                  className="h-10"
                  disabled={save.isPending || hasIssues || isCheckingPorts}
                  onClick={() => save.mutate()}
                  size="sm"
                >
                  <Save />
                  {t('common.save')}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="space-y-5 px-page pt-5">
        {settings.isLoading ? (
          <SettingsSkeleton />
        ) : settings.isError ? (
          <SettingsError error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <>
            {hasIssues ? <SettingsIssues issues={allIssues} /> : null}

            <section className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-5">
                <SettingsSection
                  kicker="VLESS"
                  logo="xray"
                  title={t('settings.realityInbound')}
                >
                  <PortControl
                    label={t('settings.vlessPort')}
                    max={65535}
                    min={1}
                    onChange={(value) => setValue('vless.port', value)}
                    presets={vlessPortPresets}
                    protocol="tcp"
                    unavailablePorts={unavailablePresetPorts('vless.port', originalValues, portAvailability.data)}
                    value={values.number('vless.port')}
                  />
                  <SelectControl
                    label={t('settings.realityTarget')}
                    onChange={(value) => setRealityPreset(value)}
                    options={[
                      ...realityPresets.map((item) => ({ label: item.label, value: item.label })),
                      { label: t('common.custom'), value: 'Custom' },
                    ]}
                    value={currentRealityPreset?.label ?? 'Custom'}
                  />
                  <TextControl
                    label="SNI"
                    onChange={(value) => setValue('reality.sni', value)}
                    placeholder="www.google.com"
                    value={values.string('reality.sni')}
                  />
                  <TextControl
                    label={t('settings.destination')}
                    onChange={(value) => setValue('reality.dest', value)}
                    placeholder="www.google.com:443"
                    value={values.string('reality.dest')}
                  />
                  <SecretControl
                    label={t('settings.privateKey')}
                    generating={generateReality.isPending}
                    onChange={(value) => setValue('reality.private_key', value)}
                    onGenerate={() => generateReality.mutate()}
                    reveal={showSecrets}
                    value={values.string('reality.private_key')}
                  />
                  <SecretControl
                    label={t('settings.publicKey')}
                    generating={generateReality.isPending}
                    onChange={(value) => setValue('reality.public_key', value)}
                    onGenerate={() => generateReality.mutate()}
                    reveal={showSecrets}
                    value={values.string('reality.public_key')}
                  />
                  <SecretControl
                    label={t('settings.shortId')}
                    onChange={(value) => setValue('reality.short_ids', [value])}
                    onGenerate={() => setValue('reality.short_ids', [randomHex(8)])}
                    reveal={showSecrets}
                    value={firstNonEmpty(values.stringArray('reality.short_ids'))}
                  />
                </SettingsSection>
              </div>

              <div className="space-y-5">
                <SettingsSection
                  kicker="Hysteria 2"
                  logo="hysteria"
                  title={t('settings.transport')}
                >
                  <TextControl
                    label={t('settings.hysteriaDomain')}
                    onChange={(value) => setValue('hy2.domain', value)}
                    placeholder="h2v.example.com"
                    value={values.string('hy2.domain')}
                  />
                  <PortControl
                    label={t('settings.hysteriaPort')}
                    max={65535}
                    min={1}
                    onChange={(value) => setValue('hy2.port', value)}
                    presets={hy2PortPresets}
                    protocol="udp"
                    unavailablePorts={unavailablePresetPorts('hy2.port', originalValues, portAvailability.data)}
                    value={values.number('hy2.port')}
                  />
                  <BandwidthControl
                    label={t('settings.uploadBandwidth')}
                    onChange={(value) => setValue('hy2.bandwidth_up', value)}
                    presets={bandwidthPresets}
                    value={values.string('hy2.bandwidth_up')}
                  />
                  <BandwidthControl
                    label={t('settings.downloadBandwidth')}
                    onChange={(value) => setValue('hy2.bandwidth_down', value)}
                    presets={bandwidthPresets}
                    value={values.string('hy2.bandwidth_down')}
                  />
                  <ToggleControl
                    label={t('settings.hysteriaMode')}
                    offLabel={t('settings.masquerade')}
                    onChange={(value) => setValue('hy2.obfs_enabled', value)}
                    onLabel={t('settings.obfs')}
                    value={values.bool('hy2.obfs_enabled')}
                  />
                  {values.bool('hy2.obfs_enabled') ? (
                    <SecretControl
                      label={t('settings.obfsPassword')}
                      onChange={(value) => setValue('hy2.obfs_password', value)}
                      onGenerate={() => setValue('hy2.obfs_password', randomSecret(24))}
                      reveal={showSecrets}
                      value={values.string('hy2.obfs_password')}
                    />
                  ) : (
                    <>
                      <SelectControl
                        label={t('settings.masquerade')}
                        onChange={(value) => {
                          if (value !== 'Custom') setValue('hy2.masquerade_url', value);
                        }}
                        options={[
                          ...masqueradePresets.map((item) => ({ label: item.label, value: item.value })),
                          { label: t('common.custom'), value: 'Custom' },
                        ]}
                        value={currentMasqueradePreset?.value ?? 'Custom'}
                      />
                      <TextControl
                        label={t('settings.masqueradeUrl')}
                        onChange={(value) => setValue('hy2.masquerade_url', value)}
                        placeholder="https://www.google.com"
                        value={values.string('hy2.masquerade_url')}
                      />
                    </>
                  )}
                  <SecretControl
                    label={t('settings.trafficStatsSecret')}
                    onChange={(value) => setValue('hy2.traffic_secret', value)}
                    onGenerate={() => setValue('hy2.traffic_secret', randomSecret(32))}
                    reveal={showSecrets}
                    value={values.string('hy2.traffic_secret')}
                  />
                </SettingsSection>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function downloadBackupFile(backup: H2VBackup) {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `h2v-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function SettingsSection({
  children,
  icon: Icon,
  kicker,
  logo,
  title,
}: {
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  kicker: string;
  logo?: CoreLogoName;
  title: string;
}) {
  return (
    <Card className="rounded-lg border-0">
      <CardContent className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={cn(
                'flex shrink-0 items-center justify-center',
                'size-9',
                !logo && 'rounded-[22px] bg-accent-gradient-soft',
              )}
            >
              {logo ? (
                <CoreLogo className="size-8" core={logo} />
              ) : Icon ? (
                <Icon className="size-4" />
              ) : null}
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
    <div className="space-y-[13px]">
      <Label>{label}</Label>
      <Input
        className={settingFieldClassName}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
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
  const { t } = useI18n();

  return (
    <div className="space-y-[13px]">
      <Label>{label}</Label>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className={cn(settingFieldClassName, 'pl-9 pr-11 font-mono')}
          onChange={(event) => onChange(event.target.value)}
          type={reveal ? 'text' : 'password'}
          value={value}
        />
        <Button
          aria-label={t('users.regenerate')}
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
  protocol,
  unavailablePorts = [],
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  presets: number[];
  protocol?: 'tcp' | 'udp';
  unavailablePorts?: number[];
  value: number;
}) {
  const { t } = useI18n();
  const unavailable = new Set(unavailablePorts);

  return (
    <div className="space-y-[13px]">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {protocol ? (
          <Badge className="px-1.5 py-0 text-[10px] uppercase tracking-normal" variant="outline">
            {protocol}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {presets.map((port) => (
          <Button
            className={cn(value !== port && settingChoiceClassName)}
            disabled={unavailable.has(port)}
            key={port}
            onClick={() => onChange(port)}
            size="sm"
            title={unavailable.has(port) ? t('common.portInUse') : undefined}
            type="button"
            variant={value === port ? 'default' : 'secondary'}
          >
            {port}
          </Button>
        ))}
        <Input
          className={cn(settingFieldClassName, 'h-9 w-28 shrink-0 font-mono text-xs')}
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
    <div className="space-y-[13px]">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2.5">
        {presets.map((preset) => (
          <Button
            className={cn(normalizedValue !== preset && settingChoiceClassName)}
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
          className={cn(settingFieldClassName, 'h-9 w-32 shrink-0 font-mono text-xs')}
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
    <div className="space-y-[13px]">
      <Label>{label}</Label>
      <div className="grid grid-cols-2 gap-1 rounded-[22px]">
        <Button
          className={cn(!value && settingChoiceClassName)}
          onClick={() => onChange(true)}
          size="sm"
          type="button"
          variant={value ? 'default' : 'ghost'}
        >
          {onLabel}
        </Button>
        <Button
          className={cn(value && settingChoiceClassName)}
          onClick={() => onChange(false)}
          size="sm"
          type="button"
          variant={!value ? 'default' : 'ghost'}
        >
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
    <div className="space-y-[13px]">
      <Label>{label}</Label>
      <select
        className={cn(
          'h-9 w-full rounded-[22px] border border-transparent bg-accent-gradient-soft px-3 text-sm text-foreground shadow-xs outline-none transition-colors',
          'hover:bg-[image:var(--gradient-accent-soft)] focus-visible:border-ring/45 focus-visible:bg-[image:var(--gradient-accent-soft)] focus-visible:ring-2 focus-visible:ring-ring/35',
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
  const { t } = useI18n();

  return (
    <div className="rounded-[22px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" />
        {t('settings.settingsNeedAttention')}
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
      {Array.from({ length: 2 }).map((_, index) => (
        <Card className="rounded-lg border-0" key={index}>
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
  const { t } = useI18n();

  return (
    <Card className="rounded-lg border-0">
      <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <div className="text-base font-semibold text-foreground">{t('settings.unableLoadSettings')}</div>
        <p className="max-w-xl text-sm text-muted-foreground">{errorMessage(error, t('common.requestFailed'))}</p>
        <Button onClick={onRetry} size="sm" variant="secondary">
          {t('common.retry')}
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

function createPortCheckItems(values: ReturnType<typeof createSettingsValues>): PortCheckItem[] {
  const checks: PortCheckItem[] = [];
  const seen = new Set<string>();

  for (const definition of portDefinitions) {
    for (const port of [values.number(definition.key), ...definition.presets]) {
      if (!validPort(port)) continue;
      const id = `${definition.key}:${definition.protocol}:${port}`;
      if (seen.has(id)) continue;
      seen.add(id);
      checks.push({ key: definition.key, port, protocol: definition.protocol });
    }
  }

  return checks;
}

function createPortIssues(
  draft: SettingsDraft,
  values: ReturnType<typeof createSettingsValues>,
  originalValues: ReturnType<typeof createSettingsValues>,
  results: PortCheckResult[],
  checkFailed: boolean,
  t: Translate,
): string[] {
  if (!hasChangedPort(draft, values, originalValues)) {
    return [];
  }
  if (checkFailed) {
    return [t('settings.validation.unableCheckPorts')];
  }

  const issues: string[] = [];
  for (const definition of portDefinitions) {
    if (draft[definition.key] === undefined) continue;
    const port = values.number(definition.key);
    if (!validPort(port) || port === originalValues.number(definition.key)) continue;
    const result = results.find(
      (item) => item.key === definition.key && item.port === port && item.protocol === definition.protocol,
    );
    if (result && !result.available) {
      issues.push(
        `${settingLabel(definition.key, t)} ${port}/${definition.protocol.toUpperCase()}: ${t('common.portInUse')}.`,
      );
    }
  }
  return issues;
}

function hasChangedPort(
  draft: SettingsDraft,
  values: ReturnType<typeof createSettingsValues>,
  originalValues: ReturnType<typeof createSettingsValues>,
): boolean {
  return portDefinitions.some(
    (definition) =>
      draft[definition.key] !== undefined && values.number(definition.key) !== originalValues.number(definition.key),
  );
}

function unavailablePresetPorts(
  key: PortKey,
  originalValues: ReturnType<typeof createSettingsValues>,
  results: PortCheckResult[] | undefined,
): number[] {
  return (results ?? [])
    .filter((item) => item.key === key && !item.available && item.port !== originalValues.number(key))
    .map((item) => item.port);
}

function validateDraft(draft: SettingsDraft, values: ReturnType<typeof createSettingsValues>, t: Translate) {
  const issues: string[] = [];
  for (const key of Object.keys(draft) as SettingKey[]) {
    if (isPortSetting(key) && !validPort(values.number(key))) {
      issues.push(t('settings.validation.portRange', { label: settingLabel(key, t) }));
    }
    if ((key.includes('domain') || key === 'reality.sni') && values.string(key).trim() === '') {
      issues.push(t('settings.validation.domainRequired', { label: settingLabel(key, t) }));
    }
    if (key === 'hy2.masquerade_url' && !validURL(values.string(key))) {
      issues.push(t('settings.validation.url', { label: settingLabel(key, t) }));
    }
    if (key === 'reality.dest' && !validHostPort(values.string(key))) {
      issues.push(t('settings.validation.realityDestHostPort'));
    }
    if (key === 'reality.short_ids' && !values.stringArray(key).every(validRealityShortID)) {
      issues.push(t('settings.validation.shortIds'));
    }
    if ((key === 'hy2.bandwidth_up' || key === 'hy2.bandwidth_down') && !validBandwidth(values.string(key))) {
      issues.push(t('settings.validation.bandwidth', { label: settingLabel(key, t) }));
    }
  }
  if (draft['hy2.obfs_enabled'] === true || draft['hy2.obfs_password'] !== undefined) {
    if (values.bool('hy2.obfs_enabled') && values.string('hy2.obfs_password').trim() === '') {
      issues.push(t('settings.validation.obfsPasswordRequired'));
    }
  }
  if (draft['reality.private_key'] !== undefined || draft['reality.public_key'] !== undefined) {
    if (values.string('reality.private_key').trim() === '' || values.string('reality.public_key').trim() === '') {
      issues.push(t('settings.validation.realityKeysTogether'));
    }
  }
  return issues;
}

function normalizeDraftForSave(draft: SettingsDraft): SettingsDraft {
  const normalized: SettingsDraft = {};
  for (const [key, value] of Object.entries(draft) as Array<[SettingKey, SettingValue]>) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (key === 'hy2.domain' || key === 'reality.sni') {
        normalized[key] = normalizeHostnameForSave(trimmed);
      } else {
        normalized[key] = trimmed;
      }
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

function settingLabel(key: SettingKey, t: Translate): string {
  return t(settingLabelKeys[key]);
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

function normalizeHostnameForSave(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].split(':')[0].replace(/\.$/, '').toLowerCase();
  }
}

function validPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isPortSetting(key: SettingKey): boolean {
  return key.endsWith('.port') || key.endsWith('_port') || key === 'vless.port';
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
  return /^\d+(?:\.\d+)?\s*(bps|kbps|mbps|gbps|tbps|k|m|g|t)$/i.test(value.trim());
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

function errorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
