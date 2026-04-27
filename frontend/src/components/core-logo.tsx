import { cn } from '@/lib/utils';

export type CoreLogoName = 'xray' | 'hysteria';

const coreLogoSrc: Record<CoreLogoName, string> = {
  hysteria: '/cores/hysteria2.svg',
  xray: '/cores/xray.svg',
};

const coreLogoAlt: Record<CoreLogoName, string> = {
  hysteria: 'Hysteria 2',
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
