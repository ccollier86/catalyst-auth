import { NextResponse } from 'next/server';

type Payload = Record<string, unknown> | undefined;

type ActionHandler = (payload: Payload) => Promise<unknown>;

const handlers: Record<string, ActionHandler> = {
  async startSignIn(payload) {
    return { flowId: `demo-flow-${payload?.email ?? 'user'}` };
  },
  async completeSignIn() {
    return { sessionToken: 'demo-token' };
  },
  async signOut() {
    return true;
  },
  async listOrganisations() {
    return [
      { id: 'org-1', name: 'Acme Inc.', role: 'Owner' }
    ];
  },
  async switchOrganisation() {
    return true;
  },
  async createOrganisation(payload) {
    return { id: `org-${(payload?.name as string)?.toLowerCase() ?? 'new'}` };
  },
  async listKeys() {
    return [
      { id: 'key-1', label: 'Primary', createdAt: new Date().toISOString() }
    ];
  },
  async createKey(payload) {
    return { id: `key-${(payload?.label as string)?.toLowerCase() ?? 'new'}` };
  },
  async revokeKey() {
    return true;
  }
};

export async function POST(request: Request) {
  const { action, payload } = (await request.json()) as {
    action: string;
    payload?: Payload;
  };

  const handler = handlers[action];
  if (!handler) {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }

  const data = await handler(payload);
  return NextResponse.json({ data });
}

export async function GET() {
  return NextResponse.json({ error: 'Method not implemented' }, { status: 405 });
}
