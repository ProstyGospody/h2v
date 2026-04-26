import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '@/lib/utils';

const THEMES = { light: '', dark: '.dark' } as const;

export type ChartConfig = {
  [k: string]: {
    color?: string;
    label?: React.ReactNode;
    theme?: Record<keyof typeof THEMES, string>;
  };
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

function ChartStyle({ config, id }: { config: ChartConfig; id: string }) {
  const colorConfig = Object.entries(config).filter(
    ([, itemConfig]) => itemConfig.theme || itemConfig.color,
  );

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart="${id}"] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] || itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .filter(Boolean)
  .join('\n')}
}
`,
          )
          .join('\n'),
      }}
    />
  );
}

export function ChartContainer({
  children,
  className,
  config,
  id,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        className={cn(
          'flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke="#ccc"]]:stroke-border [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke="#fff"]]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke="#ccc"]]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke="#ccc"]]:stroke-border [&_.recharts-sector[stroke="#fff"]]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none',
          className,
        )}
        data-chart={chartId}
        {...props}
      >
        <ChartStyle config={config} id={chartId} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

type ChartTooltipContentProps = {
  active?: boolean;
  className?: string;
  formatter?: (
    value: number | string | Array<number | string> | undefined,
    name: string,
    item: any,
    index: number,
    payload: any[],
  ) => React.ReactNode | [React.ReactNode, React.ReactNode];
  hideLabel?: boolean;
  label?: string | number;
  labelFormatter?: (
    label: string | number | undefined,
    payload: any[],
  ) => React.ReactNode;
  payload?: any[];
};

export function ChartTooltipContent({
  active,
  className,
  formatter,
  hideLabel = false,
  label,
  labelFormatter,
  payload,
}: ChartTooltipContentProps) {
  const { config } = useChart();

  if (!active || !payload?.length) {
    return null;
  }

  const renderedLabel = (() => {
    if (hideLabel) return null;
    if (labelFormatter) return labelFormatter(label, payload);
    if (typeof label === 'string' || typeof label === 'number') return label;
    return null;
  })();

  return (
    <div
      className={cn(
        'grid min-w-[8rem] gap-1.5 rounded-md border border-border/55 bg-popover px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {renderedLabel ? <div className="font-medium text-foreground">{renderedLabel}</div> : null}
      <div className="grid gap-1">
        {payload.map((item, index) => {
          const key = String(item.name || item.dataKey || index);
          const itemConfig = config[key];
          let labelText = itemConfig?.label ?? (typeof item.name === 'string' ? item.name : String(item.name));
          let valueText: React.ReactNode = item.value;

          if (formatter) {
            const formatted = formatter(
              item.value,
              typeof item.name === 'string' ? item.name : String(item.name ?? key),
              item,
              index,
              payload,
            );
            if (Array.isArray(formatted)) {
              valueText = formatted[0];
              if (formatted[1] !== undefined) {
                labelText = formatted[1];
              }
            } else {
              valueText = formatted;
            }
          }
          const color =
            item.color ||
            item.payload?.fill ||
            item.payload?.stroke ||
            itemConfig?.color ||
            `var(--color-${key})`;

          return (
            <div className="flex items-center justify-between gap-2" key={key}>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="size-2 rounded-[2px]" style={{ backgroundColor: color }} />
                <span>{labelText}</span>
              </div>
              <span className="font-mono font-medium text-foreground">{valueText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
