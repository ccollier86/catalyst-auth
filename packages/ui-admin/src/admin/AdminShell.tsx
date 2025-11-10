import { useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createBrowserRouter,
  type RouteObject,
  type Router
} from 'react-router-dom';
import type { CatalystUIClients } from '@catalyst-auth/ui-headless';
import { AdminClientsProvider } from './AdminClientsContext.js';
import { DashboardView } from './views/DashboardView.js';
import { OrganisationsView } from './views/OrganisationsView.js';
import { KeysView } from './views/KeysView.js';

export interface AdminShellProps {
  clients: CatalystUIClients;
  queryClient?: QueryClient;
  routes?: RouteObject[];
  router?: Router;
  children?: ReactNode;
}

function buildDefaultRoutes(): RouteObject[] {
  return [
    {
      path: '/',
      element: <DashboardView />
    },
    {
      path: '/organisations',
      element: <OrganisationsView />
    },
    {
      path: '/keys',
      element: <KeysView />
    }
  ];
}

export function createAdminRouter(routes: RouteObject[] = buildDefaultRoutes()) {
  return createBrowserRouter(routes);
}

/**
 * AdminShell wires together query caching, routing, and SDK client access.
 * Consumers can either provide a pre-configured React Router instance or rely
 * on the default route map that exposes dashboards for authentication, organisation,
 * and key management.
 */
export function AdminShell({ clients, queryClient, routes, router, children }: AdminShellProps) {
  const resolvedQueryClient = useMemo(
    () =>
      queryClient ??
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false
          }
        }
      }),
    [queryClient]
  );

  const resolvedRouter = useMemo(
    () => router ?? createAdminRouter(routes ?? buildDefaultRoutes()),
    [router, routes]
  );

  return (
    <AdminClientsProvider clients={clients}>
      <QueryClientProvider client={resolvedQueryClient}>
        {children ?? <RouterProvider router={resolvedRouter} />}
      </QueryClientProvider>
    </AdminClientsProvider>
  );
}
