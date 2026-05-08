import { cn } from '@/lib/utils';

export function BrandLogo({ className, alt = 'h2v' }: { className?: string; alt?: string }) {
  return <img alt={alt} className={cn('block shrink-0 object-contain', className)} src="/logo.svg" />;
}
