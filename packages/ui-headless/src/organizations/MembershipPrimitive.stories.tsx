import type { Meta, StoryObj } from '@storybook/react';
import { MembershipPrimitive } from './MembershipPrimitive.js';
import type { MembershipClient } from '../clients.js';
import { useMemo } from 'react';

const organisations = [
  { id: 'org-1', name: 'Acme Inc.', role: 'Owner' },
  { id: 'org-2', name: 'Beta Corp.', role: 'Administrator' }
];

const mockClient: MembershipClient = {
  async listOrganisations() {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return organisations;
  },
  async switchOrganisation() {
    await new Promise((resolve) => setTimeout(resolve, 30));
  },
  async createOrganisation(input) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { id: `org-${input.name.toLowerCase()}` };
  }
};

const meta: Meta<typeof MembershipPrimitive> = {
  title: 'Organisations/MembershipPrimitive',
  component: MembershipPrimitive
};

export default meta;

type Story = StoryObj<typeof MembershipPrimitive>;

export const Default: Story = {
  render: (args) => {
    const client = useMemo(() => mockClient, []);
    return (
      <MembershipPrimitive {...args} client={client}>
        {(state, actions) => (
          <div aria-live="polite">
            <p>
              Active organisation:
              <strong> {state.activeOrganisationId ?? 'Loading…'}</strong>
            </p>
            <ul>
              {state.organisations.map((organisation) => (
                <li key={organisation.id}>
                  <button
                    type="button"
                    onClick={() => void actions.setActiveOrganisation(organisation.id)}
                    disabled={state.loading}
                  >
                    {organisation.name} ({organisation.role})
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </MembershipPrimitive>
    );
  }
};
