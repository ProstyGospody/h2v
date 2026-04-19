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

  const toaster = useMemo(() => <Toaster richColors position="top-right" />, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        {toaster}
      </AuthProvider>
    </QueryClientProvider>
  );
}

