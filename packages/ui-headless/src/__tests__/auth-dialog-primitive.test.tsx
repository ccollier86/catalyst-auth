import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AuthDialogPrimitive } from '../auth/AuthDialogPrimitive.js';
import type { AuthClient } from '../clients.js';

expect.extend(toHaveNoViolations);

function buildClient(): AuthClient {
  return {
    startSignIn: vi.fn(async () => ({ flowId: 'flow-1' })),
    completeSignIn: vi.fn(async () => ({ sessionToken: 'token' })),
    signOut: vi.fn(async () => {})
  };
}

describe('AuthDialogPrimitive', () => {
  it('captures user input and orchestrates client calls', async () => {
    const user = userEvent.setup();
    const client = buildClient();

    render(
      <AuthDialogPrimitive client={client} defaultOpen>
        {(state, actions) => (
          <form
            aria-label="sign-in"
            onSubmit={(event) => {
              event.preventDefault();
              return state.flowId ? actions.complete() : actions.start();
            }}
          >
            <input
              aria-label="email"
              value={state.email}
              onChange={(event) => actions.updateEmail(event.target.value)}
            />
            {state.flowId ? (
              <input
                aria-label="code"
                value={state.verificationCode}
                onChange={(event) => actions.updateVerificationCode(event.target.value)}
              />
            ) : null}
            <button type="submit">Submit</button>
          </form>
        )}
      </AuthDialogPrimitive>
    );

    await user.type(screen.getByLabelText('email'), 'user@example.com');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(client.startSignIn).toHaveBeenCalledWith('user@example.com');

    await user.type(screen.getByLabelText('code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(client.completeSignIn).toHaveBeenCalledWith('flow-1', '123456');

    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });
});
