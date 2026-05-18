import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTheme } from '@/shared/theme/theme';

type ThemeToggleProps = {
  className?: string;
  compact?: boolean;
};

export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = nextTheme === 'light' ? 'Use light theme' : 'Use dark theme';
  const Icon = nextTheme === 'light' ? Sun : Moon;

  return (
    <Button
      aria-label={label}
      className={cn(compact ? 'size-10' : 'h-8 px-2.5 text-xs', className)}
      onClick={toggleTheme}
      size={compact ? 'icon-sm' : 'sm'}
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon className={compact ? 'size-6' : 'size-4'} data-icon="inline-start" />
      {compact ? null : <span>{nextTheme === 'light' ? 'Light' : 'Dark'}</span>}
    </Button>
  );
}
