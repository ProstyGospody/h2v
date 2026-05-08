import { cn } from '@/lib/utils';

export type CoreLogoName = 'xray' | 'hysteria' | 'telegram';

const coreLogoSrc: Record<CoreLogoName, string> = {
  hysteria: '/cores/hysteria2.svg',
  telegram: '/cores/telegram.svg',
  xray: '/cores/xray.svg',
};

const coreLogoAlt: Record<CoreLogoName, string> = {
  hysteria: 'Hysteria 2',
  telegram: 'Telegram',
  xray: 'Xray',
};

export function CoreLogo({
  className,
  core,
}: {
  className?: string;
  core: CoreLogoName;
}) {
  return (
    <img
      alt={coreLogoAlt[core]}
      className={cn('block object-contain', className)}
      draggable={false}
      src={coreLogoSrc[core]}
    />
  );
}
