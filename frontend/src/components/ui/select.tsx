import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type SelectContextValue = {
  onValueChange: (value: string) => void;
  value: string;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const context = React.useContext(SelectContext);
  if (!context) {
    throw new Error('Select components must be used within Select.');
  }
  return context;
}

function Select({
  children,
  defaultValue = '',
  onValueChange,
  value: valueProp,
}: {
  children: React.ReactNode;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  value?: string;
}) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const value = valueProp ?? uncontrolledValue;

  const handleValueChange = React.useCallback(
    (nextValue: string) => {
      if (valueProp === undefined) {
        setUncontrolledValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [onValueChange, valueProp],
  );

  const context = React.useMemo(
    () => ({ onValueChange: handleValueChange, value }),
    [handleValueChange, value],
  );

  return (
    <SelectContext.Provider value={context}>
      <DropdownMenuPrimitive.Root>{children}</DropdownMenuPrimitive.Root>
    </SelectContext.Provider>
  );
}

function SelectTrigger({
  children,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="select-trigger"
      type="button"
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-[22px] border border-transparent bg-accent-gradient-soft px-3 text-sm font-medium text-foreground shadow-xs outline-none transition-colors',
        'hover:bg-[image:var(--gradient-accent-soft)] focus-visible:border-ring/45 focus-visible:bg-[image:var(--gradient-accent-soft)] focus-visible:ring-2 focus-visible:ring-ring/35',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
    </DropdownMenuPrimitive.Trigger>
  );
}

function SelectValue({
  children,
  placeholder,
}: {
  children?: React.ReactNode;
  placeholder?: React.ReactNode;
}) {
  return <>{children ?? <span className="text-muted-foreground">{placeholder}</span>}</>;
}

function SelectContent({
  align = 'start',
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        data-slot="select-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-72 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-hidden rounded-[22px] border border-border/55 bg-card p-1 text-card-foreground shadow-pop backdrop-blur',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function SelectGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectItem({
  children,
  className,
  onSelect,
  value,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Item>, 'onSelect'> & {
  onSelect?: React.ComponentProps<typeof DropdownMenuPrimitive.Item>['onSelect'];
  value: string;
}) {
  const context = useSelectContext();
  const selected = context.value === value;

  return (
    <DropdownMenuPrimitive.Item
      data-slot="select-item"
      data-state={selected ? 'checked' : 'unchecked'}
      onSelect={(event) => {
        onSelect?.(event);
        if (!event.defaultPrevented) {
          context.onValueChange(value);
        }
      }}
      className={cn(
        'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-[18px] px-2.5 py-1.5 text-sm outline-none transition-colors',
        'focus:bg-[image:var(--gradient-accent-soft)] focus:text-foreground',
        'data-[state=checked]:bg-[image:var(--gradient-accent-soft)] data-[state=checked]:text-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
    </DropdownMenuPrimitive.Item>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
};
