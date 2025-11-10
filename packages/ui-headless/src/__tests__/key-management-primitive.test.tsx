import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KeyManagementPrimitive } from '../keys/KeyManagementPrimitive.js';
import type { KeyClient } from '../clients.js';

describe('KeyManagementPrimitive', () => {
  it('loads keys and triggers revoke', async () => {
    const user = userEvent.setup();
    const client: KeyClient = {
      listKeys: vi.fn(async () => [
        { id: 'key-1', label: 'Primary', createdAt: new Date().toISOString() }
      ]),
      createKey: vi.fn(async () => ({ id: 'key-2' })),
      revokeKey: vi.fn(async () => {})
    };

    render(
      <KeyManagementPrimitive client={client}>
        {(state, actions) => (
          <div>
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

    await waitFor(() => expect(client.listKeys).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(client.revokeKey).toHaveBeenCalledWith('key-1');
  });
});
