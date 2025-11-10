import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MembershipPrimitive } from '../organizations/MembershipPrimitive.js';
import type { MembershipClient } from '../clients.js';

describe('MembershipPrimitive', () => {
  it('refreshes organisations and allows switching', async () => {
    const user = userEvent.setup();
    const client: MembershipClient = {
      listOrganisations: vi.fn(async () => [
        { id: 'org-1', name: 'Acme', role: 'Owner' },
        { id: 'org-2', name: 'Beta', role: 'Member' }
      ]),
      switchOrganisation: vi.fn(async () => {}),
      createOrganisation: vi.fn(async () => ({ id: 'org-3' }))
    };

    render(
      <MembershipPrimitive client={client}>
        {(state, actions) => (
          <div>
            <span data-testid="active">{state.activeOrganisationId}</span>
            <button type="button" onClick={() => void actions.setActiveOrganisation('org-2')}>
              Switch
            </button>
          </div>
        )}
      </MembershipPrimitive>
    );

    await waitFor(() => expect(client.listOrganisations).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Switch' }));
    expect(client.switchOrganisation).toHaveBeenCalledWith('org-2');
  });
});
