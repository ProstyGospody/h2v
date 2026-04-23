import { PropsWithChildren, ReactNode, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { UserStatus } from '@/shared/api/types';
import { daysUntil, formatBytes, relativeExpiry, usagePercent } from '@/shared/lib/format';

export function StatusBadge({ status }: { status: UserStatus | string }) {
  if (status === 'active') {
    return (
      <Badge variant="success">
        <span className="size-1.5 rounded-full bg-success animate-pulse-ring" />
        Active
      </Badge>
    );
  }
  if (status === 'limited') return <Badge variant="destructive">Limited</Badge>;
  if (status === 'expired') return <Badge variant="warning">Expired</Badge>;
  return <Badge variant="secondary">Disabled</Badge>;
}

export function TrafficBar({
  animated = false,
  className,
  total,
  used,
}: {
  animated?: boolean;
  className?: string;
  total: number;
  used: number;
}) {
  const percent = usagePercent(used, total);
  const fillClass = percent >= 90 ? 'bg-destructive' : percent >= 70 ? 'bg-warning' : 'bg-primary';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', fillClass, animated && 'animate-traffic-fill')}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{formatBytes(used)}</span>
        <span className="font-mono">{total > 0 ? formatBytes(total) : '∞'}</span>
      </div>
    </div>
  );
}

export function CopyButton({
  className,
  label = 'Copy',
  size = 'sm',
  value,
  variant = 'secondary',
}: {
  className?: string;
  label?: string;
  size?: 'sm' | 'default' | 'lg' | 'icon';
  value: string;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost';
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      className={className}
      size={size}
      variant={variant}
      onClick={async () => {
        if (!value) return;
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
      type="button"
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {size !== 'icon' ? <span>{copied ? 'Copied' : label}</span> : null}
    </Button>
  );
}

export function MonoField({ className, label, value }: { className?: string; label?: string; value: string }) {
  return (
    <div className={cn('rounded-md bg-muted p-3', className)}>
      {label ? <div className="t-label mb-2">{label}</div> : null}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{value || '—'}</div>
        <CopyButton size="icon" value={value} variant="ghost" />
      </div>
    </div>
  );
}

type DeltaTone = 'neutral' | 'up' | 'down';

export function MetricCard({
  delta,
  deltaTone = 'neutral',
  icon,
  label,
  loading = false,
  note,
  value,
}: {
  delta?: ReactNode;
  deltaTone?: DeltaTone;
  icon?: ReactNode;
  label: string;
  loading?: boolean;
  note?: ReactNode;
  value: ReactNode;
}) {
  const deltaClass =
    deltaTone === 'up' ? 'text-success' : deltaTone === 'down' ? 'text-destructive' : 'text-muted-foreground';

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon ? <span>{icon}</span> : null}
          <span className="t-label">{label}</span>
        </div>
        {loading ? <Skeleton className="h-7 w-24" /> : <div className="t-metric text-foreground">{value}</div>}
        {loading ? (
          <Skeleton className="h-3 w-28" />
        ) : (
          <>
            {delta ? <div className={cn('text-xs', deltaClass)}>{delta}</div> : null}
            {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function DurationBadge({ value }: { value: string | null }) {
  const days = daysUntil(value);
  if (days === null) return <Badge variant="secondary">Never</Badge>;
  if (days < 0) return <Badge variant="warning">Expired</Badge>;
  if (days < 3) return <Badge variant="warning">{days}d left</Badge>;
  return <Badge variant="secondary">{days}d left</Badge>;
}

export function PageHeader({
  action,
  eyebrow,
  subtitle,
  title,
}: {
  action?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="px-5 pb-2 pt-8 sm:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1">
          {eyebrow ? <div className="t-label">{eyebrow}</div> : null}
          <h1 className="text-[26px] font-semibold leading-none tracking-[-0.01em] text-foreground">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}

export function EmptyState({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground/50">{icon}</div> : null}
      <div className="space-y-1">
        <div className="text-base font-semibold text-foreground">{title}</div>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-7 items-center justify-center rounded-md bg-primary/12 text-primary">
        <ShieldCheck className="size-4" />
      </div>
      <span
        className={cn(
          'font-serif italic leading-none tracking-[-0.02em]',
          compact ? 'text-xl' : 'text-2xl',
        )}
      >
        MyPanel
      </span>
    </div>
  );
}

export function KernelRow({ label, value }: { label: string; value: string }) {
  const running = value.toLowerCase().includes('run') || value.toLowerCase().includes('ok');
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            running ? 'bg-success animate-pulse-ring' : 'bg-warning',
          )}
        />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  );
}

export function OnlineDot({ className }: PropsWithChildren<{ className?: string }>) {
  return <span className={cn('size-1.5 rounded-full bg-success animate-pulse-ring', className)} />;
}

export function DetailStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}
