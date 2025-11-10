import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MembershipClient } from '../clients.js';

type Organisation = Awaited<ReturnType<MembershipClient['listOrganisations']>>[number];

export interface MembershipPrimitiveState {
  organisations: Organisation[];
  loading: boolean;
  error?: string;
  activeOrganisationId?: string;
  creatingOrganisation: boolean;
}

export interface MembershipPrimitiveProps {
  client: MembershipClient;
  /** Called whenever the state mutates. */
  children: (state: MembershipPrimitiveState, actions: MembershipPrimitiveActions) => JSX.Element;
  /** Optionally provide the organisation that should be considered active on mount. */
  initialOrganisationId?: string;
}

export interface MembershipPrimitiveActions {
  refresh(): Promise<void>;
  createOrganisation(input: { name: string }): Promise<void>;
  setActiveOrganisation(organisationId: string): Promise<void>;
}

export function MembershipPrimitive({ client, children, initialOrganisationId }: MembershipPrimitiveProps) {
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [activeOrganisationId, setActiveOrganisationId] = useState<string | undefined>(initialOrganisationId);
  const [creatingOrganisation, setCreatingOrganisation] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await client.listOrganisations();
      setOrganisations(result);
      if (!activeOrganisationId && result.length > 0) {
        setActiveOrganisationId(result[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeOrganisationId, client]);

  const createOrganisation = useCallback(
    async (input: { name: string }) => {
      setCreatingOrganisation(true);
      setError(undefined);
      try {
        const { id } = await client.createOrganisation(input);
        await refresh();
        setActiveOrganisationId(id);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setCreatingOrganisation(false);
      }
    },
    [client, refresh]
  );

  const setActiveOrganisation = useCallback(
    async (organisationId: string) => {
      setError(undefined);
      try {
        await client.switchOrganisation(organisationId);
        setActiveOrganisationId(organisationId);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [client]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const state = useMemo<MembershipPrimitiveState>(
    () => ({ organisations, loading, error, activeOrganisationId, creatingOrganisation }),
    [organisations, loading, error, activeOrganisationId, creatingOrganisation]
  );

  const actions = useMemo<MembershipPrimitiveActions>(
    () => ({ refresh, createOrganisation, setActiveOrganisation }),
    [createOrganisation, refresh, setActiveOrganisation]
  );

  return children(state, actions);
}
