import { useQuery } from '@tanstack/react-query';
import { CoreLogo, type CoreLogoName } from '@/components/core-logo';
import { cn } from '@/lib/utils';
import { apiClient } from '@/shared/api/client';
import type { OverviewStats } from '@/shared/api/types';
import { useI18n } from '@/shared/i18n/i18n';

type StatusTone = 'ok' | 'warn' | 'idle';

type ServiceStatusItem = {
  label: string;
  logo?: CoreLogoName;
  showIndicator?: boolean;
  tone?: StatusTone;
  value: string;
};

const serviceStatusRefetchIntervalMs = 5_000;

export function ServiceStatusIsland() {
  const { t } = useI18n();
  const overview = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: () => apiClient.request<OverviewStats>('/stats/overview'),
    refetchInterval: serviceStatusRefetchIntervalMs,
  });
  const data = overview.data;
  const items: ServiceStatusItem[] = [
    {
      label: 'Xray',
      logo: 'xray',
      tone: serviceTone(data?.xray_status, overview.isError),
      value: serviceStatusLabel(data?.xray_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
    },
    {
      label: 'Hysteria 2',
      logo: 'hysteria',
      tone: serviceTone(data?.hysteria_status, overview.isError),
      value: serviceStatusLabel(data?.hysteria_status, overview.isLoading, overview.isError, t),
      showIndicator: true,
    },
  ];

  return (
    <section aria-label={t('nav.services')} className="flex w-full min-w-0 max-w-full justify-center sm:w-auto">
      <div className="flex w-fit max-w-full flex-wrap items-center justify-center gap-2 rounded-[22px] bg-accent-gradient-soft px-3 py-1.5 shadow-sm">
        {items.map((item) => {
          return (
            <div
              className="flex h-7 min-w-0 items-center gap-1.5 rounded-[18px] px-1 text-foreground transition-colors hover:bg-muted/25"
              key={item.label}
              title={`${item.label}: ${item.value}`}
            >
              {item.logo ? (
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full">
                  <CoreLogo className={cn(item.logo === 'hysteria' ? 'h-5 w-7' : 'size-5')} core={item.logo} />
                </span>
              ) : null}
              <span className="min-w-0 truncate text-xs font-medium leading-5">{item.label}</span>
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
