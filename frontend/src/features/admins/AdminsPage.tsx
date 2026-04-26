import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/page-header';
import { apiClient, ApiError } from '@/shared/api/client';
import { Admin } from '@/shared/api/types';
import { formatDate, formatDateTime } from '@/shared/lib/format';
import { useAuth } from '@/features/auth/useAuth';

export function AdminsPage() {
  const queryClient = useQueryClient();
  const { admin: currentAdmin } = useAuth();

  const admins = useQuery({
    queryKey: ['admins'],
    queryFn: () => apiClient.request<Admin[]>('/admins'),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<Admin | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Admin | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['admins'] });
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Admins"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Create admin
          </Button>
        }
      />

      <div className="px-page pt-6">
        <Card className="overflow-hidden">
          {admins.isLoading ? (
            <CardContent className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </CardContent>
          ) : admins.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Last login</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.data.map((admin) => {
                  const isSelf = admin.id === currentAdmin?.id;
                  return (
                    <TableRow key={admin.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{admin.username}</span>
                          {isSelf ? <Badge variant="outline">you</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {admin.role}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {admin.last_login_at ? formatDateTime(admin.last_login_at) : '—'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {formatDate(admin.created_at)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setPasswordTarget(admin)}>
                              <KeyRound />
                              Change password
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={isSelf}
                              onSelect={() => setDeleteTarget(admin)}
                              variant="destructive"
                            >
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <CardContent className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              No admins yet.
            </CardContent>
          )}
        </Card>
      </div>

      <CreateAdminDialog
        onClose={() => setCreateOpen(false)}
        onCreated={refresh}
        open={createOpen}
      />
      <ChangePasswordDialog
        admin={passwordTarget}
        onClose={() => setPasswordTarget(null)}
      />
      <DeleteAdminDialog
        admin={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={refresh}
      />
    </div>
  );
}

function CreateAdminDialog({
  onClose,
  onCreated,
  open,
}: {
  onClose: () => void;
  onCreated: () => Promise<void> | void;
  open: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('admin');

  const create = useMutation({
    mutationFn: () =>
      apiClient.request<Admin>('/admins', {
        body: JSON.stringify({ username: username.trim(), password, role: role.trim() || 'admin' }),
        method: 'POST',
      }),
    onSuccess: async () => {
      toast.success('Admin created');
      setUsername('');
      setPassword('');
      setRole('admin');
      onClose();
      await onCreated();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to create admin');
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
      setPassword('');
    }
  }

  const canSubmit = username.trim().length > 0 && password.length > 0 && !create.isPending;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create admin</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="admin-username">Username</Label>
            <Input
              autoComplete="off"
              id="admin-username"
              onChange={(e) => setUsername(e.target.value)}
              value={username}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              autoComplete="new-password"
              id="admin-password"
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              value={password}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-role">Role</Label>
            <Input
              autoComplete="off"
              id="admin-role"
              onChange={(e) => setRole(e.target.value)}
              value={role}
            />
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!canSubmit} type="submit">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({
  admin,
  onClose,
}: {
  admin: Admin | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');

  const update = useMutation({
    mutationFn: () => {
      if (!admin) throw new Error('no_admin');
      return apiClient.request(`/admins/${admin.id}`, {
        body: JSON.stringify({ password }),
        method: 'PATCH',
      });
    },
    onSuccess: () => {
      toast.success('Password updated');
      setPassword('');
      onClose();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to update password');
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
      setPassword('');
    }
  }

  const canSubmit = password.length > 0 && !update.isPending;

  return (
    <Dialog onOpenChange={handleOpenChange} open={admin !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            update.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">User</Label>
            <div className="font-medium text-foreground">{admin?.username}</div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-new-password">New password</Label>
            <Input
              autoComplete="new-password"
              id="admin-new-password"
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              value={password}
            />
          </div>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!canSubmit} type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAdminDialog({
  admin,
  onClose,
  onDeleted,
}: {
  admin: Admin | null;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const remove = useMutation({
    mutationFn: () => {
      if (!admin) throw new Error('no_admin');
      return apiClient.request(`/admins/${admin.id}`, { method: 'DELETE' });
    },
    onSuccess: async () => {
      toast.success('Admin deleted');
      onClose();
      await onDeleted();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Unable to delete admin');
    },
  });

  return (
    <Dialog onOpenChange={(next) => (next ? null : onClose())} open={admin !== null}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {admin?.username}?</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            type="button"
            variant="destructive"
          >
            <Trash2 />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
