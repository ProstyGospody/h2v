import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Timer, type LucideIcon } from 'lucide-react';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import type { OverviewStats } from '@/shared/api/types';
import { useI18n } from '@/shared/i18n/i18n';
import { formatDurationCompact } from '@/shared/lib/format';

type StatusTone = 'ok' | 'warn' | 'idle';

type ServiceStatusItem = {
  icon?: LucideIcon;
  label: string;
  logo?: CoreLogoName;
  showIndicator?: boolean;
  showValue?: boolean;
  tone?: StatusTone;
  value: string;
};

const serviceStatusRefetchIntervalMs = 5_000;

export function ServiceStatusIsland() {
  const { locale, t } = useI18n();
  const gradientId = `service-status-icon-${useId().replace(/:/g, '')}`;
  const overview = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiClient.request<OverviewStats>('/stats/overview'),
    refetchInterval: serviceStatusRefetchIntervalMs,
  });
  const data = overview.data;
  const items: ServiceStatusItem[] = [
    {
      label: t('shell.uptime'),
      icon: Timer,
      value: formatDurationCompact(data?.uptime_seconds, locale),
      showIndicator: false,
      showValue: true,
    },
    {
      label: 'Xray',
      logo: 'xray',
      tone: serviceTone(data?.xray_status, overview.isError),
      value: serviceStatusLabel(data?.xray_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
      showValue: false,
    },
    {
      label: 'Hysteria 2',
      logo: 'hysteria',
      tone: serviceTone(data?.hysteria_status, overview.isError),
      value: serviceStatusLabel(data?.hysteria_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
      showValue: false,
    },
  ];

  return (
    <section aria-label={t('nav.services')} className="flex w-full min-w-0 max-w-full justify-center sm:w-auto">
      <div className="flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-[22px] bg-accent-gradient-soft px-3 py-1.5 shadow-sm">
        <svg aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
          <defs>
            <linearGradient id={gradientId} x1="4" x2="20" y1="4" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="var(--icon-gradient-start)" />
              <stop offset="0.45" stopColor="var(--icon-gradient-mid)" />
              <stop offset="1" stopColor="var(--icon-gradient-end)" />
            </linearGradient>
          </defs>
        </svg>
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <div
              className="flex h-7 min-w-0 items-center gap-1.5 rounded-[18px] px-1 text-foreground transition-colors hover:bg-muted/25"
              key={item.label}
              title={`${item.label}: ${item.value}`}
            >
              {item.logo || Icon ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full">
                  {item.logo ? (
                    <CoreLogo className={cn(item.logo === 'hysteria' ? 'h-5 w-7' : 'size-5')} core={item.logo} />
                  ) : Icon ? (
                    <Icon className="size-4" stroke={`url(#${gradientId})`} strokeWidth={2.35} />
                  ) : null}
                </span>
              ) : null}
              <span className="min-w-0 truncate text-xs font-medium leading-5">{item.label}</span>
              {item.showValue ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{item.value}</span>
              ) : null}
              {item.showIndicator ? (
                <span
                  aria-label={item.value}
                  className={cn('size-2 shrink-0 rounded-full ring-2', serviceDotTone(item.tone ?? 'idle'))}
                  title={item.value}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function serviceTone(value: string | undefined, isError: boolean): StatusTone {
  if (isError) return 'warn';
  if (!value) return 'idle';
  return value.toLowerCase().startsWith('fail') ? 'warn' : 'ok';
}

function serviceStatusLabel(
  value: string | undefined,
  isLoading: boolean,
  isError: boolean,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (isError) return t('common.issue');
  if (isLoading && !value) return t('common.syncing');
  if (!value) return t('common.unknown');
  return value.toLowerCase().startsWith('fail') ? t('common.issue') : t('common.ok');
}

function serviceDotTone(tone: StatusTone): string {
  if (tone === 'ok') return 'bg-success ring-success/15';
  if (tone === 'warn') return 'bg-warning ring-warning/15';
  return 'bg-muted-foreground ring-muted-foreground/10';
}
