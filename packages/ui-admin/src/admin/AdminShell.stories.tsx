import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient } from '@tanstack/react-query';
import { AdminShell } from './AdminShell.js';
import type { CatalystUIClients } from '@catalyst-auth/ui-headless';

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
        { id: 'org-1', name: 'Acme Inc.', role: 'Owner' },
        { id: 'org-2', name: 'Beta Corp', role: 'Administrator' }
      ];
    },
    async switchOrganisation() {},
    async createOrganisation() {
      return { id: 'org-3' };
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

const meta: Meta<typeof AdminShell> = {
  title: 'Admin/AdminShell',
  component: AdminShell,
  parameters: {
    layout: 'fullscreen'
  }
};

export default meta;

type Story = StoryObj<typeof AdminShell>;

export const Default: Story = {
  render: () => <AdminShell clients={clients} queryClient={new QueryClient()} />
};
