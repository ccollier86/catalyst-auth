import { createContext, useContext } from 'react';
import type { CatalystUIClients } from '@catalyst-auth/ui-headless';

const AdminClientsContext = createContext<CatalystUIClients | null>(null);

export interface AdminClientsProviderProps {
  clients: CatalystUIClients;
  children: React.ReactNode;
}

export function AdminClientsProvider({ clients, children }: AdminClientsProviderProps) {
  return <AdminClientsContext.Provider value={clients}>{children}</AdminClientsContext.Provider>;
}

export function useAdminClients(): CatalystUIClients {
  const value = useContext(AdminClientsContext);
  if (!value) {
    throw new Error('useAdminClients must be used within an AdminClientsProvider');
  }
  return value;
}
