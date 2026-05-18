import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title?: string;
  titleClassName?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  actionClassName?: string;
  className?: string;
}

export function PageHeader({ action, actionClassName, className, description, title, titleClassName }: PageHeaderProps) {
  const hasHeading = Boolean(title || description);
  if (!hasHeading && !action) return null;

  return (
    <header
      className={cn(
        'px-page pb-1 pt-5 sm:pt-6',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-10 min-w-0 flex-col justify-center gap-3 sm:flex-row sm:items-center sm:gap-4',
          hasHeading ? 'sm:justify-between' : 'items-stretch sm:justify-end',
        )}
      >
        {hasHeading ? (
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 space-y-1">
              {title ? (
                <h1 className={cn('max-w-full truncate font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl', titleClassName)}>
                  {title}
                </h1>
              ) : null}
              {description ? (
                <p className="min-w-0 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {action ? (
          <div className={cn('flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end', actionClassName)}>
            {action}
          </div>
        ) : null}
      </div>
    </header>
  );
}
