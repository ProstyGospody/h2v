import { format, formatDistanceToNowStrict, isPast } from 'date-fns';
import { enUS, ru } from 'date-fns/locale';
import type { Locale as AppLocale } from '@/shared/i18n/i18n';

const dateLocales = {
  en: enUS,
  ru,
} satisfies Record<AppLocale, typeof enUS>;

export function formatBytes(value: number): string {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size > 10 ? 0 : 1)} ${units[index]}`;
}

export function formatBytesPerSecond(value: number): string {
  return `${formatBytes(value)}/s`;
}

export function formatNumber(value: number, locale: AppLocale = 'en'): string {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US').format(value);
}

export function usagePercent(used: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (used / total) * 100));
}

export function formatPercent(value: number | undefined): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped.toFixed(1)}%`;
}

export function formatDurationCompact(totalSeconds: number | undefined, locale: AppLocale = 'en'): string {
  if (typeof totalSeconds !== 'number' || Number.isNaN(totalSeconds) || totalSeconds < 0) {
    return '--';
  }

  const units = locale === 'ru' ? { day: 'д', hour: 'ч', minute: 'м' } : { day: 'd', hour: 'h', minute: 'm' };
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  const remMinutes = minutes % 60;

  if (days > 0) {
    return remHours > 0 ? `${days}${units.day} ${remHours}${units.hour}` : `${days}${units.day}`;
  }
  if (hours > 0) {
    return remMinutes > 0 ? `${hours}${units.hour} ${remMinutes}${units.minute}` : `${hours}${units.hour}`;
  }
  if (minutes > 0) {
    return `${minutes}${units.minute}`;
  }
  return `<1${units.minute}`;
}

export function relativeExpiry(value: string | null, locale: AppLocale = 'en'): string {
  if (!value) return locale === 'ru' ? 'Бессрочно' : 'Never expires';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === 'ru' ? 'Срок неизвестен' : 'Unknown expiry';
  if (isPast(date)) {
    return formatDistanceToNowStrict(date, { addSuffix: true, locale: dateLocales[locale] });
  }
  const distance = formatDistanceToNowStrict(date, { locale: dateLocales[locale] });
  return locale === 'ru' ? `осталось ${distance}` : `${distance} left`;
}

export function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function formatDate(value: string | Date | null, pattern: string | undefined = undefined, locale: AppLocale = 'en'): string {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return format(date, pattern ?? defaultDatePattern(locale), { locale: dateLocales[locale] });
}

export function formatDateTime(value: string | Date | null, locale: AppLocale = 'en'): string {
  return formatDate(value, locale === 'ru' ? 'd MMM yyyy HH:mm' : 'MMM d, yyyy HH:mm', locale);
}

export function formatShortDateTime(value: string | Date | null, locale: AppLocale = 'en'): string {
  return formatDate(value, locale === 'ru' ? 'd MMM  HH:mm' : 'MMM d  HH:mm', locale);
}

export function formatMonthDay(value: string | Date | null, locale: AppLocale = 'en'): string {
  return formatDate(value, locale === 'ru' ? 'd MMM' : 'MMM d', locale);
}

function defaultDatePattern(locale: AppLocale): string {
  return locale === 'ru' ? 'd MMM yyyy' : 'MMM d, yyyy';
}
