import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyClient } from '../clients.js';

type Key = Awaited<ReturnType<KeyClient['listKeys']>>[number];

export interface KeyManagementPrimitiveState {
  keys: Key[];
  loading: boolean;
  error?: string;
  creating: boolean;
}

export interface KeyManagementPrimitiveProps {
  client: KeyClient;
  children: (state: KeyManagementPrimitiveState, actions: KeyManagementPrimitiveActions) => JSX.Element;
}

export interface KeyManagementPrimitiveActions {
  refresh(): Promise<void>;
  createKey(input: { label: string }): Promise<void>;
  revokeKey(keyId: string): Promise<void>;
}

export function KeyManagementPrimitive({ client, children }: KeyManagementPrimitiveProps) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await client.listKeys();
      setKeys(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client]);

  const createKey = useCallback(
    async (input: { label: string }) => {
      setCreating(true);
      setError(undefined);
      try {
        await client.createKey(input);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setCreating(false);
      }
    },
    [client, refresh]
  );

  const revokeKey = useCallback(
    async (keyId: string) => {
      setError(undefined);
      try {
        await client.revokeKey(keyId);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [client, refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const state = useMemo<KeyManagementPrimitiveState>(
    () => ({ keys, loading, error, creating }),
    [keys, loading, error, creating]
  );

  const actions = useMemo<KeyManagementPrimitiveActions>(
    () => ({ refresh, createKey, revokeKey }),
    [createKey, refresh, revokeKey]
  );

  return children(state, actions);
}
