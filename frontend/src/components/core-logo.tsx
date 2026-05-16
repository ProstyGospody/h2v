import { cn } from '@/lib/utils';
import { useTheme } from '@/shared/theme/theme';

export type CoreLogoName = 'xray' | 'hysteria';

const coreLogoSrc: Record<CoreLogoName, string> = {
  hysteria: '/cores/hysteria2.svg',
  xray: '/cores/xray.svg',
};

const coreLogoLightSrc: Record<CoreLogoName, string> = {
  hysteria: '/cores/hysteria2-light.svg',
  xray: '/cores/xray-light.svg',
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
  const { theme } = useTheme();
  const src = theme === 'light' ? coreLogoLightSrc[core] : coreLogoSrc[core];

  return (
    <img
      alt={coreLogoAlt[core]}
      data-core-logo={core}
      className={cn('block object-contain', className)}
      draggable={false}
      src={src}
    />
  );
}
