import { Separator } from '@/components/ui/separator';

interface PageHeaderProps {
  title: string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function PageHeader({ title, subtitle, left, right }: PageHeaderProps) {
  return (
    <>
      <div className="px-5 pt-8 pb-4 sm:px-8">
        {left && <div className="mb-3">{left}</div>}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-1">
            {typeof title === 'string' ? (
              <h1 className="text-2xl font-semibold leading-none tracking-[-0.01em] text-foreground">
                {title}
              </h1>
            ) : (
              title
            )}
            {subtitle &&
              (typeof subtitle === 'string' ? (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              ) : (
                subtitle
              ))}
          </div>

          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </div>
      </div>

      <Separator />
    </>
  );
}
