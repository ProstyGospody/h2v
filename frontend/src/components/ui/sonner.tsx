import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '@/shared/theme/theme';

const toastThemeVars = {
  '--normal-bg': 'hsl(var(--card))',
  '--normal-border': 'hsl(var(--border) / 0.45)',
  '--normal-text': 'hsl(var(--card-foreground))',
  '--success-bg': 'hsl(var(--card))',
  '--success-border': 'hsl(var(--success) / 0.35)',
  '--success-text': 'hsl(var(--card-foreground))',
  '--error-bg': 'hsl(var(--card))',
  '--error-border': 'hsl(var(--destructive) / 0.4)',
  '--error-text': 'hsl(var(--card-foreground))',
  '--warning-bg': 'hsl(var(--card))',
  '--warning-border': 'hsl(var(--warning) / 0.35)',
  '--warning-text': 'hsl(var(--card-foreground))',
} as CSSProperties;

function Toaster({ style, ...props }: ToasterProps) {
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      offset={16}
      style={{ ...toastThemeVars, ...style }}
      toastOptions={{
        classNames: {
          toast:
            'group toast rounded-[22px] border border-border/45 bg-card px-4 py-3 text-sm text-card-foreground shadow-pop',
          title: 'text-sm font-medium',
          description: 'text-xs text-muted-foreground',
          actionButton:
            'rounded-[18px] bg-accent-gradient px-2.5 py-1 text-xs font-medium text-primary-foreground',
          cancelButton:
            'rounded-[18px] bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground',
          success: 'border-success/35 [&_[data-icon]>svg]:text-success',
          error: 'border-destructive/40 [&_[data-icon]>svg]:text-destructive',
          warning: 'border-warning/35 [&_[data-icon]>svg]:text-warning',
          info: 'border-border/45',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
