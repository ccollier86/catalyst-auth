import type { CatalystUIClients } from '@catalyst-auth/ui-headless';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

export function buildClients(): CatalystUIClients {
  return {
    auth: {
      async startSignIn(email: string) {
        return request('/api/proxy', {
          method: 'POST',
          body: JSON.stringify({ action: 'startSignIn', email }),
          headers: { 'Content-Type': 'application/json' }
        });
      },
      async completeSignIn(flowId: string, code: string) {
        return request('/api/proxy', {
          method: 'POST',
          body: JSON.stringify({ action: 'completeSignIn', flowId, code }),
          headers: { 'Content-Type': 'application/json' }
        });
      },
      async signOut() {
        await request('/api/proxy', {
          method: 'POST',
          body: JSON.stringify({ action: 'signOut' }),
          headers: { 'Content-Type': 'application/json' }
        });
      }
    },
    membership: {
      async listOrganisations() {
        return request('/api/organisations');
      },
      async switchOrganisation(organisationId: string) {
        await request('/api/proxy', {
          method: 'POST',
          body: JSON.stringify({ action: 'switchOrganisation', organisationId }),
          headers: { 'Content-Type': 'application/json' }
        });
      },
      async createOrganisation(input: { name: string }) {
        return request('/api/proxy', {
          method: 'POST',
          body: JSON.stringify({ action: 'createOrganisation', ...input }),
          headers: { 'Content-Type': 'application/json' }
        });
      }
    },
    keys: {
      async listKeys() {
        return request('/api/keys');
      },
      async createKey(input: { label: string }) {
        return request('/api/proxy', {
          method: 'POST',
          body: JSON.stringify({ action: 'createKey', ...input }),
          headers: { 'Content-Type': 'application/json' }
        });
      },
      async revokeKey(keyId: string) {
        await request('/api/proxy', {
          method: 'POST',
          body: JSON.stringify({ action: 'revokeKey', keyId }),
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  };
}
