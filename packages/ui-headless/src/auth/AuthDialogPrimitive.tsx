import { useCallback, useMemo, useState } from 'react';
import type { AuthClient } from '../clients.js';

export interface AuthDialogPrimitiveState {
  /** Indicates whether the dialog should be visible. */
  open: boolean;
  /** Email address captured in the primary form. */
  email: string;
  /** Verification code or OTP entered by the user. */
  verificationCode: string;
  /** Active flow identifier returned by the injected SDK client. */
  flowId?: string;
  /** True when the primitive is waiting for an async mutation to finish. */
  loading: boolean;
  /** Optional error message that can be surfaced by the host UI. */
  error?: string;
}

export interface AuthDialogPrimitiveProps {
  /** Injected SDK client implementation. */
  client: AuthClient;
  /**
   * The primitive is intentionally headless; it renders nothing and instead invokes
   * this callback with the latest state whenever it changes. Consumers typically
   * connect the state to Radix dialog primitives.
   */
  children: (state: AuthDialogPrimitiveState, actions: AuthDialogPrimitiveActions) => JSX.Element;
  /** Allow callers to control the initial visibility of the dialog. */
  defaultOpen?: boolean;
}

export interface AuthDialogPrimitiveActions {
  /** Set the open state from the parent UI. */
  setOpen(next: boolean): void;
  /** Persist the email input as the user types. */
  updateEmail(value: string): void;
  /** Persist the verification code input as the user types. */
  updateVerificationCode(value: string): void;
  /** Trigger the SDK to begin the sign-in flow. */
  start(): Promise<void>;
  /** Complete the flow using the stored verification code. */
  complete(): Promise<void>;
  /** Abort the flow and reset state. */
  reset(): void;
}

/**
 * A renderless container that orchestrates the Catalyst Auth email-based authentication flow.
 * The primitive intentionally mirrors the `Dialog` API exposed by Radix UI by exposing `open`
 * and `setOpen` controls. It can therefore be paired with `@radix-ui/react-dialog` components
 * without bespoke adapters.
 */
export function AuthDialogPrimitive({ client, children, defaultOpen = false }: AuthDialogPrimitiveProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [flowId, setFlowId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const reset = useCallback(() => {
    setEmail('');
    setVerificationCode('');
    setFlowId(undefined);
    setLoading(false);
    setError(undefined);
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const { flowId: newFlowId } = await client.startSignIn(email);
      setFlowId(newFlowId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client, email]);

  const complete = useCallback(async () => {
    if (!flowId) {
      setError('Cannot complete sign-in without an active flow.');
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      await client.completeSignIn(flowId, verificationCode);
      setOpen(false);
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client, flowId, verificationCode, reset]);

  const state = useMemo<AuthDialogPrimitiveState>(
    () => ({ open, email, verificationCode, flowId, loading, error }),
    [open, email, verificationCode, flowId, loading, error]
  );

  const actions = useMemo<AuthDialogPrimitiveActions>(
    () => ({
      setOpen,
      updateEmail: setEmail,
      updateVerificationCode: setVerificationCode,
      start,
      complete,
      reset
    }),
    [complete, reset, start]
  );

  return children(state, actions);
}
