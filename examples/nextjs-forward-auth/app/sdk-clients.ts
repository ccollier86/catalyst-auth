'use client';

import type { CatalystUIClients } from '@catalyst-auth/ui-headless';

type ForwardAuthResponse<T> = {
  data: T;
};

async function request<T>(action: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as ForwardAuthResponse<T>;
  return payload.data;
}

export function buildCatalystClients(): CatalystUIClients {
  return {
    auth: {
      async startSignIn(email: string) {
        return request<{ flowId: string }>('startSignIn', { email });
      },
      async completeSignIn(flowId: string, code: string) {
        return request<{ sessionToken: string }>('completeSignIn', { flowId, code });
      },
      async signOut() {
        await request('signOut');
      }
    },
    membership: {
      async listOrganisations() {
        return request('listOrganisations');
      },
      async switchOrganisation(organisationId: string) {
        await request('switchOrganisation', { organisationId });
      },
      async createOrganisation(input: { name: string }) {
        return request('createOrganisation', input);
      }
    },
    keys: {
      async listKeys() {
        return request('listKeys');
      },
      async createKey(input: { label: string }) {
        return request('createKey', input);
      },
      async revokeKey(keyId: string) {
        await request('revokeKey', { keyId });
      }
    }
  };
}
