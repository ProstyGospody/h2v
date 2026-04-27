import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ action, className, description, title }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'px-page pb-1 pt-5 sm:pt-6',
        className,
      )}
    >
      <div className="flex min-h-9 min-w-0 flex-col justify-center gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="max-w-full whitespace-nowrap font-serif text-2xl font-normal italic leading-none text-white sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </div>
    </header>
  );
}
