import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FileCode2, LayoutDashboard, Settings2, UserRound, Users, Zap } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { apiClient } from '@/shared/api/client';
import type { User } from '@/shared/api/types';

export function CommandPalette({ onClose, open }: { onClose: () => void; open: boolean }) {
  const navigate = useNavigate();

  const users = useQuery({
    enabled: open,
    queryKey: ['palette-users'],
    queryFn: () => apiClient.request<User[]>('/users?per_page=100'),
    staleTime: 30_000,
  });

  function go(run: () => void) {
    onClose();
    run();
  }

  return (
    <CommandDialog onOpenChange={(next) => (next ? null : onClose())} open={open}>
      <CommandInput placeholder="Jump to page or user..." />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => go(() => navigate({ to: '/' }))}>
            <LayoutDashboard />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: '/users' }))}>
            <Users />
            <span>Users</span>
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: '/settings' }))}>
            <Settings2 />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Configs">
          <CommandItem
            onSelect={() => go(() => navigate({ to: '/configs/$core', params: { core: 'xray' } }))}
          >
            <FileCode2 />
            <span>Xray config</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              go(() => navigate({ to: '/configs/$core', params: { core: 'hysteria' } }))
            }
          >
            <Zap />
            <span>Hysteria config</span>
          </CommandItem>
        </CommandGroup>

        {(users.data ?? []).length ? (
          <CommandGroup heading="Users">
            {users.data!.map((user) => (
              <CommandItem
                key={user.id}
                keywords={[user.username, user.note ?? '', user.status]}
                onSelect={() => go(() => navigate({ to: '/users' }))}
                value={user.username}
              >
                <UserRound />
                <span>{user.username}</span>
                {user.note ? (
                  <span className="ml-auto truncate text-xs text-muted-foreground">{user.note}</span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
}
