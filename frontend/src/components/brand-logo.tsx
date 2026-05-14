import { cn } from '@/lib/utils';
import { useTheme } from '@/shared/theme/theme';

export function BrandLogo({ className, alt = 'h2v' }: { className?: string; alt?: string }) {
  const { theme } = useTheme();
  const src = theme === 'light' ? '/logo-light.svg' : '/logo.svg';

  return <img alt={alt} className={cn('block shrink-0 object-contain', className)} draggable={false} src={src} />;
}
