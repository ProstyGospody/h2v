import { formatDistanceToNowStrict } from 'date-fns';

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

export function relativeExpiry(value: string | null): string {
  if (!value) return 'No expiry';
  return `${formatDistanceToNowStrict(new Date(value))} left`;
}

