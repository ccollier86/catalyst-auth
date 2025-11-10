import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { AdminShell } from '../admin/AdminShell.js';
import type { CatalystUIClients } from '@catalyst-auth/ui-headless';
import { createMemoryRouter, type RouteObject } from 'react-router-dom';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

const clients: CatalystUIClients = {
  auth: {
    startSignIn: vi.fn(async () => ({ flowId: 'flow-1' })),
    completeSignIn: vi.fn(async () => ({ sessionToken: 'token' })),
    signOut: vi.fn(async () => {})
  },
  membership: {
    listOrganisations: vi.fn(async () => [
      { id: 'org-1', name: 'Acme', role: 'Owner' }
    ]),
    switchOrganisation: vi.fn(async () => {}),
    createOrganisation: vi.fn(async () => ({ id: 'org-2' }))
  },
  keys: {
    listKeys: vi.fn(async () => [
      { id: 'key-1', label: 'Primary', createdAt: new Date().toISOString() }
    ]),
    createKey: vi.fn(async () => ({ id: 'key-2' })),
    revokeKey: vi.fn(async () => {})
  }
};

describe('AdminShell', () => {
  it('renders default dashboard and triggers queries', async () => {
    const router = createMemoryRouter([{ path: '/', element: <div>placeholder</div> }]);
    render(
      <AdminShell clients={clients} queryClient={new QueryClient()} router={router}>
        <div>Injected children</div>
      </AdminShell>
    );

    expect(await screen.findByText('Injected children')).toBeInTheDocument();
  });

  it('renders default routes when router is not provided', async () => {
    const user = userEvent.setup();
    render(<AdminShell clients={clients} queryClient={new QueryClient()} />);

    await waitFor(() => expect(clients.membership.listOrganisations).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Launch sign-in' }));
    await waitFor(() => expect(clients.auth.startSignIn).toHaveBeenCalled());

    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });

  it('supports custom routes', async () => {
    const routes: RouteObject[] = [
      { path: '/', element: <div>Custom</div> }
    ];
    render(<AdminShell clients={clients} queryClient={new QueryClient()} routes={routes} />);

    expect(await screen.findByText('Custom')).toBeInTheDocument();
  });
});
