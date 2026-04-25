import { Separator } from '@/components/ui/separator';

interface PageHeaderProps {
  title: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <>
      <div className="flex items-center justify-between px-4 py-6">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {action && <div className="flex items-center gap-2">{action}</div>}
      </div>
      <Separator />
    </>
  );
}
