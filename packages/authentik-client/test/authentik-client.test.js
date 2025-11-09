import test from 'node:test';
import assert from 'node:assert/strict';

import { AuthentikClient } from '../dist/index.js';

const BASE_URL = 'https://idp.example';

const createFetchStub = () => {
  const calls = [];
  const responses = new Map();

  const keyFor = (method, url) => `${method.toUpperCase()} ${url}`;

  const willRespond = (method, url, response) => {
    const entry = {
      status: response.status ?? 200,
      ok:
        typeof response.ok === 'boolean'
          ? response.ok
          : (response.status ?? 200) >= 200 && (response.status ?? 200) < 300,
      body:
        typeof response.body === 'string'
          ? response.body
          : response.body === undefined
            ? ''
            : JSON.stringify(response.body),
    };

    const key = keyFor(method, url);
    const queue = responses.get(key) ?? [];
    queue.push(entry);
    responses.set(key, queue);
  };

  const fetch = async (input, init = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const key = keyFor(method, input);
    const queue = responses.get(key);

    calls.push({ url: input, method, init: { ...init } });

    if (!queue || queue.length === 0) {
      throw new Error(`No stubbed response for ${key}`);
    }

    const response = queue.shift();

    return {
      ok: response.ok,
      status: response.status,
      headers: { get: () => null },
      text: async () => response.body,
    };
  };

  return { fetch, calls, willRespond };
};

const fixedClock = (value) => ({ now: () => new Date(value) });

const createClient = (options = {}) => {
  const fetchStub = options.fetchStub ?? createFetchStub();

  const client = new AuthentikClient({
    baseUrl: BASE_URL,
    clientId: 'client-id',
    clientSecret: options.clientSecret ?? 'client-secret',
    adminTokenProvider: options.adminTokenProvider ?? (async () => 'admin-token'),
    fetch: fetchStub.fetch,
    clock: options.clock ?? fixedClock('2024-01-01T00:00:00.000Z'),
    defaultScopes: options.defaultScopes ?? ['openid', 'profile'],
  });

  return { client, fetchStub };
};

test('exchanges authorization code for tokens and maps expiry relative to clock', async () => {
  const { fetchStub, client } = createClient();

  fetchStub.willRespond('POST', `${BASE_URL}/application/o/token/`, {
    status: 200,
    body: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      scope: 'openid profile',
      expires_in: 120,
    },
  });

  const result = await client.exchangeCodeForTokens({
    code: 'auth-code',
    redirectUri: 'https://app.example/callback',
    clientId: 'client-id',
    codeVerifier: 'pkce-verifier',
  });

  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  assert.equal(result.value.accessToken, 'access-token');
  assert.equal(result.value.refreshToken, 'refresh-token');
  assert.equal(result.value.expiresAt, '2024-01-01T00:02:00.000Z');

  assert.equal(fetchStub.calls.length, 1);
  const [call] = fetchStub.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${BASE_URL}/application/o/token/`);

  const params = new URLSearchParams(call.init.body);
  assert.equal(params.get('grant_type'), 'authorization_code');
  assert.equal(params.get('code'), 'auth-code');
  assert.equal(params.get('redirect_uri'), 'https://app.example/callback');
  assert.equal(params.get('client_id'), 'client-id');
  assert.equal(params.get('code_verifier'), 'pkce-verifier');
  assert.equal(params.get('client_secret'), 'client-secret');
  assert.equal(params.get('scope'), 'openid profile');
});

test('builds effective identity merging profile groups when directory lookup returns 404', async () => {
  const fetchStub = createFetchStub();
  const { client } = createClient({ fetchStub });

  fetchStub.willRespond('GET', `${BASE_URL}/api/v3/core/users/user-1/`, {
    status: 200,
    body: {
      uuid: 'user-1',
      email: 'user@example.com',
      name: 'User Example',
      groups: ['profile-group'],
    },
  });

  fetchStub.willRespond('GET', `${BASE_URL}/api/v3/core/sessions/?user__uuid=user-1`, {
    status: 200,
    body: [
      {
        uuid: 'session-1',
        user: 'user-1',
        created: '2023-12-31T23:59:30.000Z',
        last_seen: '2024-01-01T00:00:00.000Z',
        factors: ['password'],
      },
    ],
  });

  fetchStub.willRespond('GET', `${BASE_URL}/api/v3/core/groups/?members__uuid=user-1`, {
    status: 404,
    ok: false,
    body: {
      detail: 'Not found',
    },
  });

  const identityResult = await client.buildEffectiveIdentity('user-1', 'org-1');

  assert.equal(identityResult.ok, true, identityResult.ok ? undefined : identityResult.error);
  assert.equal(identityResult.value.userId, 'user-1');
  assert.equal(identityResult.value.orgId, 'org-1');
  assert.equal(identityResult.value.sessionId, 'session-1');
  assert.deepEqual(identityResult.value.groups, ['profile-group']);
});

test('merges profile groups with directory groups when available', async () => {
  const fetchStub = createFetchStub();
  const { client } = createClient({ fetchStub });

  fetchStub.willRespond('GET', `${BASE_URL}/api/v3/core/users/user-2/`, {
    status: 200,
    body: {
      uuid: 'user-2',
      email: 'two@example.com',
      name: 'User Two',
      groups_obj: [{ name: 'profile-group' }],
    },
  });

  fetchStub.willRespond('GET', `${BASE_URL}/api/v3/core/sessions/?user__uuid=user-2`, {
    status: 200,
    body: {
      results: [
        {
          uuid: 'session-2',
          user: 'user-2',
          created: '2023-12-31T23:00:00.000Z',
          last_seen: '2024-01-01T00:00:00.000Z',
          factors: ['password'],
        },
      ],
    },
  });

  fetchStub.willRespond('GET', `${BASE_URL}/api/v3/core/groups/?members__uuid=user-2`, {
    status: 200,
    body: {
      results: [
        { name: 'directory-group' },
        { slug: 'directory-group' },
      ],
    },
  });

  const identityResult = await client.buildEffectiveIdentity('user-2');

  assert.equal(identityResult.ok, true, identityResult.ok ? undefined : identityResult.error);
  assert.deepEqual(identityResult.value.groups.sort(), ['directory-group', 'profile-group']);
});

test('validates access tokens and surfaces claims from introspection', async () => {
  const fetchStub = createFetchStub();
  const { client } = createClient({ fetchStub });

  fetchStub.willRespond('POST', `${BASE_URL}/application/o/introspect/`, {
    status: 200,
    body: {
      active: true,
      sub: 'user-3',
      exp: Math.floor(Date.parse('2024-01-01T01:00:00.000Z') / 1000),
      scope: 'openid profile',
    },
  });

  const validation = await client.validateAccessToken('access-token');

  assert.equal(validation.ok, true, validation.ok ? undefined : validation.error);
  assert.equal(validation.value.active, true);
  assert.equal(validation.value.subject, 'user-3');
  assert.equal(validation.value.expiresAt, '2024-01-01T01:00:00.000Z');
  assert.equal(validation.value.claims.scope, 'openid profile');

  const [call] = fetchStub.calls;
  const params = new URLSearchParams(call.init.body);
  assert.equal(params.get('token'), 'access-token');
  assert.equal(params.get('client_id'), 'client-id');
  assert.equal(params.get('client_secret'), 'client-secret');
});

test('surfaces infra error when admin token provider returns empty token', async () => {
  const fetchStub = createFetchStub();
  const emptyProvider = async () => '';
  const { client } = createClient({ fetchStub, adminTokenProvider: emptyProvider });

  const result = await client.fetchUserProfile('user-4');

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTHENTIK_ADMIN_TOKEN_MISSING');
  assert.equal(fetchStub.calls.length, 0);
});
