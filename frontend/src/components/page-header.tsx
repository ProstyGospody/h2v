import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  center?: React.ReactNode;
  className?: string;
}

export function PageHeader({ action, center, className, description, title }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'relative px-page pb-1 pt-5 sm:pt-6',
        className,
      )}
    >
      {center ? (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 hidden justify-center px-page xl:flex">
          <div className="pointer-events-auto max-w-full">{center}</div>
        </div>
      ) : null}
      <div className="flex min-h-9 min-w-0 flex-col justify-center gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <SidebarTrigger className="-ml-1 size-8 rounded-md bg-transparent text-muted-foreground/75 shadow-none hover:bg-muted/45 hover:bg-none hover:text-foreground focus-visible:ring-ring/30 [&_svg]:size-4" />
          <div className="min-w-0 space-y-1">
            <h1 className="max-w-full truncate font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="min-w-0 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{action}</div>
        ) : null}
      </div>
    </header>
  );
}
