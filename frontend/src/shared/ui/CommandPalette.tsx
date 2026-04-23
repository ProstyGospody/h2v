import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  CornerDownLeft,
  FileCode2,
  LayoutDashboard,
  ScrollText,
  Search,
  Settings2,
  UserRound,
  Users,
  Zap,
} from 'lucide-react';
import { apiClient } from '@/shared/api/client';
import { User } from '@/shared/api/types';
import { cn } from '@/shared/ui/primitives';

type PaletteRoute =
  | { type: 'page'; to: '/'; params?: never }
  | { type: 'page'; to: '/users'; params?: never }
  | { type: 'page'; to: '/settings'; params?: never }
  | { type: 'page'; to: '/audit'; params?: never }
  | { type: 'page'; to: '/configs/$core'; params: { core: 'xray' | 'hysteria' } };

type PaletteItem = {
  description?: string;
  icon: ReactNode;
  id: string;
  keywords: string[];
  label: string;
  route: PaletteRoute;
  section: string;
};

const staticItems: PaletteItem[] = [
  {
    id: 'page:dashboard',
    icon: <LayoutDashboard className="size-4" />,
    keywords: ['dashboard', 'overview', 'home'],
    label: 'Dashboard',
    route: { type: 'page', to: '/' },
    section: 'Navigation',
  },
  {
    id: 'page:users',
    icon: <Users className="size-4" />,
    keywords: ['users', 'subscribers', 'people'],
    label: 'Users',
    route: { type: 'page', to: '/users' },
    section: 'Navigation',
  },
  {
    id: 'page:settings',
    icon: <Settings2 className="size-4" />,
    keywords: ['settings', 'config', 'options'],
    label: 'Settings',
    route: { type: 'page', to: '/settings' },
    section: 'Navigation',
  },
  {
    id: 'page:audit',
    icon: <ScrollText className="size-4" />,
    keywords: ['audit', 'log', 'events', 'history'],
    label: 'Audit log',
    route: { type: 'page', to: '/audit' },
    section: 'Navigation',
  },
  {
    id: 'page:configs-xray',
    description: 'Edit runtime JSON',
    icon: <FileCode2 className="size-4" />,
    keywords: ['xray', 'vless', 'reality', 'config'],
    label: 'Xray config',
    route: { type: 'page', to: '/configs/$core', params: { core: 'xray' } },
    section: 'Configs',
  },
  {
    id: 'page:configs-hysteria',
    description: 'Edit runtime YAML/JSON',
    icon: <Zap className="size-4" />,
    keywords: ['hysteria', 'hy2', 'udp', 'obfs'],
    label: 'Hysteria config',
    route: { type: 'page', to: '/configs/$core', params: { core: 'hysteria' } },
    section: 'Configs',
  },
];

export function CommandPalette({ onClose, open }: { onClose: () => void; open: boolean }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const users = useQuery({
    enabled: open,
    queryKey: ['palette-users'],
    queryFn: () => apiClient.request<User[]>('/users?per_page=100'),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = original;
    };
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const userItems: PaletteItem[] = (users.data ?? []).map((user) => ({
      description: user.note || undefined,
      icon: <UserRound className="size-4" />,
      id: `user:${user.id}`,
      keywords: [user.username, user.note ?? '', user.status],
      label: user.username,
      route: { type: 'page', to: '/users' },
      section: 'Users',
    }));

    const all = [...staticItems, ...userItems];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((item) => {
      if (item.label.toLowerCase().includes(needle)) return true;
      return item.keywords.some((keyword) => keyword.toLowerCase().includes(needle));
    });
  }, [query, users.data]);

  const grouped = useMemo(() => {
    const map = new Map<string, PaletteItem[]>();
    for (const item of items) {
      const bucket = map.get(item.section) ?? [];
      bucket.push(item);
      map.set(item.section, bucket);
    }
    return Array.from(map.entries());
  }, [items]);

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(Math.max(0, items.length - 1));
    }
  }, [activeIndex, items.length]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  if (!open) return null;

  function select(item: PaletteItem) {
    onClose();
    if (item.route.type === 'page') {
      if (item.route.to === '/configs/$core') {
        navigate({ to: item.route.to, params: item.route.params });
      } else {
        navigate({ to: item.route.to });
      }
    }
  }

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % Math.max(1, items.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + items.length) % Math.max(1, items.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) select(item);
    } else if (event.key === 'Escape') {
      onClose();
    }
  }

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 px-4 pt-[12vh] animate-[modal-fade_120ms_ease-out]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-[0_24px_80px_-12px_rgba(0,0,0,0.7)] animate-[modal-scale_150ms_ease-out]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            aria-label="Search pages and users"
            className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-faint"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKey}
            placeholder="Jump to page or user..."
            ref={inputRef}
            value={query}
          />
          <kbd className="font-mono text-[10px] text-faint">ESC</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2" ref={listRef}>
          {items.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">No matches for "{query}"</div>
          ) : (
            grouped.map(([section, bucket]) => (
              <div className="mb-1.5 last:mb-0" key={section}>
                <div className="t-label px-3 py-1.5">{section}</div>
                {bucket.map((item) => {
                  const index = runningIndex++;
                  const active = index === activeIndex;
                  return (
                    <button
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition',
                        active
                          ? 'bg-[hsl(var(--primary)/0.1)] text-foreground shadow-[inset_2px_0_0_hsl(var(--primary))]'
                          : 'text-muted-foreground hover:bg-[hsl(var(--hover-overlay))] hover:text-foreground',
                      )}
                      data-index={index}
                      key={item.id}
                      onClick={() => select(item)}
                      onMouseEnter={() => setActiveIndex(index)}
                      type="button"
                    >
                      <span className={cn(active ? 'text-primary' : 'text-muted-foreground')}>{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="truncate text-foreground">{item.label}</span>
                        {item.description ? (
                          <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                        ) : null}
                      </span>
                      {active ? <CornerDownLeft className="size-3.5 text-primary" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-elevated px-4 py-2.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
              open
            </span>
          </div>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
            toggle
          </span>
        </div>
      </div>
    </div>
  );
}

export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
}
