import { PropsWithChildren, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/features/auth/useAuth';

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 5_000,
          },
        },
      }),
  );

  const toaster = useMemo(
    () => (
      <Toaster
        closeButton
        duration={4000}
        position="bottom-right"
        theme="dark"
        toastOptions={{
          classNames: {
            toast:
              'group rounded-md border border-border bg-surface-elevated px-4 py-3 text-sm text-foreground shadow-[0_16px_48px_-12px_rgba(0,0,0,0.6)]',
            title: 'text-sm font-medium',
            description: 'text-xs text-muted-foreground',
            actionButton: 'rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground',
            cancelButton: 'rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground',
            success: 'border-success/30',
            error: 'border-destructive/35',
            warning: 'border-warning/30',
            info: 'border-border',
          },
        }}
      />
    ),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        {toaster}
      </AuthProvider>
    </QueryClientProvider>
  );
}
