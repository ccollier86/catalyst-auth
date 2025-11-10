import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminClients } from '../admin/AdminClientsContext.js';

export function useOrganisationsQuery() {
  const { membership } = useAdminClients();
  return useQuery({
    queryKey: ['organisations'],
    queryFn: () => membership.listOrganisations()
  });
}

export function useSwitchOrganisationMutation() {
  const queryClient = useQueryClient();
  const { membership } = useAdminClients();
  return useMutation({
    mutationFn: (organisationId: string) => membership.switchOrganisation(organisationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organisations'] });
    }
  });
}

export function useCreateOrganisationMutation() {
  const queryClient = useQueryClient();
  const { membership } = useAdminClients();
  return useMutation({
    mutationFn: (input: { name: string }) => membership.createOrganisation(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organisations'] });
    }
  });
}

export function useKeysQuery() {
  const { keys } = useAdminClients();
  return useQuery({
    queryKey: ['keys'],
    queryFn: () => keys.listKeys()
  });
}

export function useCreateKeyMutation() {
  const queryClient = useQueryClient();
  const { keys } = useAdminClients();
  return useMutation({
    mutationFn: (input: { label: string }) => keys.createKey(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['keys'] });
    }
  });
}

export function useRevokeKeyMutation() {
  const queryClient = useQueryClient();
  const { keys } = useAdminClients();
  return useMutation({
    mutationFn: (keyId: string) => keys.revokeKey(keyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['keys'] });
    }
  });
}
