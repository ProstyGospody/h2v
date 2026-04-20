import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  TextareaHTMLAttributes,
  useState,
} from 'react';
import { Check, Copy, Loader2, Shield, Sparkles } from 'lucide-react';
import type { UserStatus } from '@/shared/api/types';
import { daysUntil, formatBytes, formatDate, formatPercent, relativeExpiry, usagePercent } from '@/shared/lib/format';

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function Card({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <section className={cn('rounded-lg border border-border bg-surface shadow-[inset_0_1px_0_hsl(var(--foreground)/0.02)]', className)}>{children}</section>;
}

export function CardHeader({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('flex flex-col gap-2 border-b border-border px-6 py-5', className)}>{children}</div>;
}

export function CardTitle({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <h2 className={cn('t-h2 text-foreground', className)}>{children}</h2>;
}

export function CardDescription({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;
}

export function CardContent({ children, className }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('p-6', className)}>{children}</div>;
}

type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const buttonVariants: Record<ButtonVariant, string> = {
  default: 'border-primary/20 bg-primary text-primary-foreground shadow-primary-glow hover:brightness-105',
  secondary: 'border-border bg-surface-elevated text-foreground hover:border-border-strong hover:bg-[hsl(var(--hover-overlay))]',
  outline: 'border-primary/35 bg-surface-elevated text-primary hover:border-primary/60 hover:bg-[hsl(var(--primary)/0.08)]',
  ghost: 'border-transparent bg-transparent text-muted-foreground hover:bg-[hsl(var(--hover-overlay))] hover:text-foreground',
  destructive: 'border-destructive/30 bg-destructive text-destructive-foreground hover:brightness-110',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-sm',
  icon: 'h-10 w-10 px-0',
};

type BaseButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button({
  busy = false,
  className,
  children,
  disabled,
  leadingIcon,
  size = 'md',
  trailingIcon,
  variant = 'default',
  ...props
}: BaseButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || busy}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium transition duration-150 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : leadingIcon}
      <span>{children}</span>
      {!busy ? trailingIcon : null}
    </button>
  );
}

export function SecondaryButton(props: Omit<BaseButtonProps, 'variant'>) {
  return <Button variant="secondary" {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-sm text-foreground outline-none transition placeholder:text-faint focus:border-border-strong focus:bg-surface-elevated',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'min-h-28 w-full rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-faint focus:border-border-strong focus:bg-surface-elevated',
        className,
      )}
    />
  );
}

export function Label({ children, className, ...props }: PropsWithChildren<LabelHTMLAttributes<HTMLLabelElement>>) {
  return (
    <label {...props} className={cn('t-label block', className)}>
      {children}
    </label>
  );
}

type BadgeTone = 'default' | 'success' | 'warning' | 'danger';

export function Badge({ children, className, tone = 'default' }: PropsWithChildren<{ className?: string; tone?: BadgeTone }>) {
  const tones: Record<BadgeTone, string> = {
    default: 'border-border bg-surface-elevated text-muted-foreground',
    success: 'border-success/25 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  };
  return <span className={cn('inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em]', tones[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: UserStatus | string }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-2 rounded-md bg-success/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-success">
        <span className="size-1.5 rounded-full bg-success shadow-[0_0_0_0_hsl(var(--success)/0.6)] [animation:pulse-ring_2s_ease-out_infinite]" />
        Active
      </span>
    );
  }

  if (status === 'limited') {
    return <Badge tone="danger">Limited</Badge>;
  }

  if (status === 'expired') {
    return <Badge tone="warning">Expired</Badge>;
  }

  return <Badge>Disabled</Badge>;
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
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="t-label">Used</span>
        <span className="t-code text-muted-foreground">{formatPercent(percent)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-sm border border-border bg-surface-sunken">
        <div className={cn('h-full rounded-sm', fillClass, animated && 'traffic-fill')} style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{formatBytes(used)}</span>
        <span>{total > 0 ? formatBytes(total) : 'Unlimited'}</span>
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
  size?: ButtonSize;
  value: string;
  variant?: ButtonVariant;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      className={className}
      size={size}
      variant={variant}
      leadingIcon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      onClick={async () => {
        if (!value) return;
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }}
      type="button"
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function MonoField({ className, label, value }: { className?: string; label?: string; value: string }) {
  return (
    <div className={cn('rounded-md border border-border bg-surface-sunken p-3', className)}>
      {label ? <div className="t-label mb-2">{label}</div> : null}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-foreground">{value || 'N/A'}</div>
        <CopyButton label="" size="icon" value={value} variant="ghost" />
      </div>
    </div>
  );
}

export function MetricCard({
  icon,
  label,
  note,
  value,
}: {
  icon?: ReactNode;
  label: string;
  note?: ReactNode;
  value: ReactNode;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="t-label">{label}</div>
          {icon ? <div className="rounded-md border border-border bg-surface-elevated p-2 text-primary">{icon}</div> : null}
        </div>
        <div className="space-y-2">
          <div className="t-metric">{value}</div>
          {note ? <div className="text-sm text-muted-foreground">{note}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function DurationBadge({ value }: { value: string | null }) {
  const days = daysUntil(value);
  if (days === null) {
    return <Badge>Never</Badge>;
  }
  if (days < 0) {
    return <Badge tone="warning">Expired</Badge>;
  }
  if (days < 3) {
    return <Badge tone="warning">{days}d left</Badge>;
  }
  return <Badge>{days}d left</Badge>;
}

export function PageHeader({ action, subtitle, title }: { action?: ReactNode; subtitle: string; title: string }) {
  return (
    <header className="border-b border-border px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-2">
          <div className="t-label">Admin panel</div>
          <div>
            <h1 className="t-h1 text-foreground">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} aria-hidden="true" />;
}

export function EmptyState({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  description: string;
  icon?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
      <div className="rounded-lg border border-border bg-surface-elevated p-4 text-muted-foreground">{icon ?? <Sparkles className="size-8" />}</div>
      <div className="space-y-2">
        <div className="text-lg font-semibold text-foreground">{title}</div>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function BrandMark({ compact = false, subtitle }: { compact?: boolean; subtitle?: string }) {
  return (
    <div className={cn('flex items-center gap-3', compact && 'gap-2')}>
      <div className="flex size-9 items-center justify-center rounded-md border border-primary/30 bg-primary/12 text-primary">
        <Shield className="size-4" />
      </div>
      <div className="min-w-0">
        <div className={cn('font-serif text-2xl italic leading-none tracking-[-0.02em]', compact && 'text-lg')}>MyPanel</div>
        {subtitle ? <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div> : null}
      </div>
    </div>
  );
}

export function KernelIndicator({ label, value }: { label: string; value: string }) {
  const isRunning = value.toLowerCase().includes('run') || value.toLowerCase().includes('ok');
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-elevated px-3 py-3">
      <div>
        <div className="t-label">{label}</div>
        <div className="mt-1 text-sm text-foreground">{value}</div>
      </div>
      <span className={cn('size-2 rounded-full', isRunning ? 'bg-success shadow-[0_0_0_0_hsl(var(--success)/0.6)] [animation:pulse-ring_2s_ease-out_infinite]' : 'bg-warning')} />
    </div>
  );
}

export function DetailStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-3 text-sm last:border-none last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}

export function MetaStamp({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-1">
      <div className="t-label">{label}</div>
      <div className="text-sm text-foreground">{relativeExpiry(value)}</div>
      <div className="text-xs text-muted-foreground">{value ? formatDate(value) : 'No date set'}</div>
    </div>
  );
}
