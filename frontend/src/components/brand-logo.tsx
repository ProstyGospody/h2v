import { cn } from '@/lib/utils';

export function BrandLogo({ className, alt = 'h2v' }: { className?: string; alt?: string }) {
  return (
    <span data-brand-logo className={cn('relative inline-block shrink-0', className)}>
      <img alt={alt} className="block size-full object-contain" draggable={false} src="/logo.svg" />
    </span>
  );
}
