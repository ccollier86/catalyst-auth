import type { Meta, StoryObj } from '@storybook/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMemo } from 'react';
import { AuthDialogPrimitive } from './AuthDialogPrimitive.js';
import type { AuthClient } from '../clients.js';

const mockClient: AuthClient = {
  async startSignIn(email) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { flowId: `flow-${email}` };
  },
  async completeSignIn() {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { sessionToken: 'token' };
  },
  async signOut() {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const meta: Meta<typeof AuthDialogPrimitive> = {
  title: 'Auth/AuthDialogPrimitive',
  component: AuthDialogPrimitive,
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'label',
            enabled: true
          }
        ]
      }
    }
  }
};

export default meta;

type Story = StoryObj<typeof AuthDialogPrimitive>;

export const Default: Story = {
  render: (args) => {
    const client = useMemo(() => mockClient, []);
    return (
      <AuthDialogPrimitive {...args} client={client}>
        {(state, actions) => (
          <Dialog.Root open={state.open} onOpenChange={actions.setOpen}>
            <Dialog.Trigger asChild>
              <button type="button">Sign in</button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay style={{ background: 'rgba(0,0,0,0.4)', position: 'fixed', inset: 0 }} />
              <Dialog.Content
                style={{
                  background: 'white',
                  borderRadius: 12,
                  padding: 24,
                  width: 'min(90vw, 420px)',
                  margin: '10vh auto'
                }}
              >
                <Dialog.Title>Sign in</Dialog.Title>
                <Dialog.Description>Magic link authentication</Dialog.Description>
                {!state.flowId && (
                  <form
                    aria-label="start sign-in"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void actions.start();
                    }}
                  >
                    <label style={{ display: 'grid', gap: 4 }}>
                      Email
                      <input
                        type="email"
                        value={state.email}
                        onChange={(event) => actions.updateEmail(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit" disabled={state.loading} style={{ marginTop: 16 }}>
                      Send code
                    </button>
                  </form>
                )}
                {state.flowId && (
                  <form
                    aria-label="complete sign-in"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void actions.complete();
                    }}
                  >
                    <label style={{ display: 'grid', gap: 4 }}>
                      Verification code
                      <input
                        value={state.verificationCode}
                        onChange={(event) => actions.updateVerificationCode(event.target.value)}
                        required
                      />
                    </label>
                    <button type="submit" disabled={state.loading} style={{ marginTop: 16 }}>
                      Verify
                    </button>
                  </form>
                )}
                {state.error ? (
                  <p role="alert" style={{ color: 'crimson' }}>
                    {state.error}
                  </p>
                ) : null}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </AuthDialogPrimitive>
    );
  },
  args: {
    defaultOpen: true
  }
};
