import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminClientsProvider } from '@catalyst-auth/ui-admin';
import { App } from './App';
import { buildClients } from './clients';

const queryClient = new QueryClient();
const clients = buildClients();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AdminClientsProvider clients={clients}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AdminClientsProvider>
  </React.StrictMode>
);
