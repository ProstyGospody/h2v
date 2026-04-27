import { format, formatDistanceToNowStrict, isPast } from 'date-fns';

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

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
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

export function relativeExpiry(value: string | null): string {
  if (!value) return 'Never expires';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown expiry';
  if (isPast(date)) {
    return formatDistanceToNowStrict(date, { addSuffix: true });
  }
  return `${formatDistanceToNowStrict(date)} left`;
}

export function daysUntil(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function formatDate(value: string | Date | null, pattern = 'MMM d, yyyy'): string {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return format(date, pattern);
}

export function formatDateTime(value: string | Date | null): string {
  return formatDate(value, 'MMM d, yyyy HH:mm');
}

export function formatShortDateTime(value: string | Date | null): string {
  return formatDate(value, 'MMM d  HH:mm');
}
