import type { Meta, StoryObj } from '@storybook/react';
import { KeyManagementPrimitive } from './KeyManagementPrimitive.js';
import type { KeyClient } from '../clients.js';
import { useMemo } from 'react';

const mockClient: KeyClient = {
  async listKeys() {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return [
      { id: 'key-1', label: 'Production API', createdAt: new Date().toISOString() },
      { id: 'key-2', label: 'CLI token', createdAt: new Date().toISOString() }
    ];
  },
  async createKey(input) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { id: `key-${input.label.toLowerCase()}` };
  },
  async revokeKey() {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

const meta: Meta<typeof KeyManagementPrimitive> = {
  title: 'Keys/KeyManagementPrimitive',
  component: KeyManagementPrimitive
};

export default meta;

type Story = StoryObj<typeof KeyManagementPrimitive>;

export const Default: Story = {
  render: (args) => {
    const client = useMemo(() => mockClient, []);
    return (
      <KeyManagementPrimitive {...args} client={client}>
        {(state, actions) => (
          <div>
            <button
              type="button"
              onClick={() => void actions.createKey({ label: 'New Key' })}
              disabled={state.creating}
            >
              Create key
            </button>
            <ul>
              {state.keys.map((key) => (
                <li key={key.id}>
                  <span>{key.label}</span>
                  <button type="button" onClick={() => void actions.revokeKey(key.id)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </KeyManagementPrimitive>
    );
  }
};
