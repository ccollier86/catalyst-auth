import type { Preview } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminClientsProvider } from '../src/admin/AdminClientsContext.js';
import type { CatalystUIClients } from '@catalyst-auth/ui-headless';

const preview: Preview = {
  parameters: {
    a11y: {
      element: '#root'
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/
      }
    }
  },
  decorators: [
    (Story) => {
      const clients: CatalystUIClients = {
        auth: {
          async startSignIn() {
            return { flowId: 'storybook' };
          },
          async completeSignIn() {
            return { sessionToken: 'token' };
          },
          async signOut() {}
        },
        membership: {
          async listOrganisations() {
            return [
              { id: 'org-1', name: 'Acme Inc.', role: 'Owner' }
            ];
          },
          async switchOrganisation() {},
          async createOrganisation() {
            return { id: 'org-2' };
          }
        },
        keys: {
          async listKeys() {
            return [
              { id: 'key-1', label: 'Primary', createdAt: new Date().toISOString() }
            ];
          },
          async createKey() {
            return { id: 'key-2' };
          },
          async revokeKey() {}
        }
      };

      const queryClient = new QueryClient();

      return (
        <AdminClientsProvider clients={clients}>
          <QueryClientProvider client={queryClient}>
            <Story />
          </QueryClientProvider>
        </AdminClientsProvider>
      );
    }
  ]
};

export default preview;
