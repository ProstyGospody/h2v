import { Check, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { getLocaleLabel, getSupportedLocales, useI18n } from '@/shared/i18n/i18n';

type LanguageSwitcherProps = {
  align?: 'center' | 'end' | 'start';
  className?: string;
  compact?: boolean;
};

export function LanguageSwitcher({ align = 'end', className, compact = false }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t('language.switch')}
          className={cn(compact ? 'size-8' : 'h-8 px-2.5 text-xs', className)}
          size={compact ? 'icon-sm' : 'sm'}
          type="button"
          variant="ghost"
        >
          <Globe className={compact ? 'size-5' : 'size-4'} />
          {compact ? null : <span className="font-mono uppercase">{locale}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {getSupportedLocales().map((item) => (
          <DropdownMenuItem key={item} onSelect={() => setLocale(item)}>
            {item === locale ? <Check className="size-4" /> : <span className="size-4" />}
            <span>{t(getLocaleLabel(item))}</span>
            <span className="ml-auto font-mono text-[10px] uppercase text-muted-foreground">{item}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
