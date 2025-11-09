import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { TokenService, createTokenService } from '../dist/index.js';

const decodeSection = (segment) => {
  const padded = segment.padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
};

const decodeJwt = (token) => {
  const [header, payload, signature] = token.split('.');
  return {
    header: JSON.parse(decodeSection(header)),
    payload: JSON.parse(decodeSection(payload)),
    signature,
  };
};

const fixedIdentity = {
  userId: 'user-123',
  orgId: 'org-456',
  sessionId: 'sess-789',
  groups: ['engineering'],
  labels: { plan: 'pro', region: 'us' },
  roles: ['admin'],
  entitlements: ['feature:a'],
  scopes: ['read', 'write'],
};

const rsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaPrivatePem = rsaKeyPair.privateKey.export({ type: 'pkcs1', format: 'pem' });

const edKeyPair = generateKeyPairSync('ed25519');
const edPrivatePem = edKeyPair.privateKey.export({ format: 'pem', type: 'pkcs8' });

const fixedNow = new Date('2024-01-01T00:00:00.000Z');
const nowFn = () => new Date(fixedNow);

const buildService = (overrides = {}) =>
  new TokenService({
    issuer: 'https://auth.catalyst.test',
    decision: {
      signer: {
        algorithm: 'RS256',
        privateKey: rsaPrivatePem,
        keyId: 'rsa-decision',
      },
      audience: 'traefik',
      defaultTtlSeconds: 30,
    },
    access: {
      signer: {
        algorithm: 'RS256',
        privateKey: rsaPrivatePem,
        keyId: 'rsa-access',
      },
      audience: 'api',
      defaultTtlSeconds: 600,
    },
    refresh: {
      signer: {
        algorithm: 'RS256',
        privateKey: rsaPrivatePem,
        keyId: 'rsa-refresh',
      },
      defaultTtlSeconds: 3600,
    },
    now: nowFn,
    jtiFactory: () => 'jti-fixed',
    ...overrides,
  });

test('mints decision JWTs with identity and resource context', async () => {
  const service = buildService();
  const result = await service.mintDecisionJwt({
    identity: fixedIdentity,
    action: 'GET /api/tenants',
    resource: {
      type: 'service',
      id: 'svc-1',
      labels: { region: 'us-east-1' },
    },
    environment: { router: 'edge-1' },
  });

  assert.equal(result.ok, true);
  assert.match(result.value.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(result.value.expiresAt, '2024-01-01T00:00:30.000Z');

  const decoded = decodeJwt(result.value.token);
  assert.equal(decoded.header.alg, 'RS256');
  assert.equal(decoded.header.kid, 'rsa-decision');
  assert.equal(decoded.payload.iss, 'https://auth.catalyst.test');
  assert.equal(decoded.payload.sub, 'user-123');
  assert.equal(decoded.payload.token_type, 'decision');
  assert.equal(decoded.payload.action, 'GET /api/tenants');
  assert.equal(decoded.payload.org, 'org-456');
  assert.equal(decoded.payload.session, 'sess-789');
  assert.equal(decoded.payload.aud, 'traefik');
  assert.deepEqual(decoded.payload.groups, ['engineering']);
  assert.deepEqual(decoded.payload.roles, ['admin']);
  assert.deepEqual(decoded.payload.entitlements, ['feature:a']);
  assert.deepEqual(decoded.payload.scopes, ['read', 'write']);
  assert.deepEqual(decoded.payload.labels, { plan: 'pro', region: 'us' });
  assert.deepEqual(decoded.payload.resource, {
    type: 'service',
    id: 'svc-1',
    labels: { region: 'us-east-1' },
  });
  assert.deepEqual(decoded.payload.environment, { router: 'edge-1' });
  assert.equal(decoded.payload.iat, 1704067200);
  assert.equal(decoded.payload.exp, 1704067230);
  assert.equal(decoded.payload.jti, 'jti-fixed');
});

test('allows ttl and audience overrides per invocation', async () => {
  const service = buildService();
  const result = await service.mintDecisionJwt({
    identity: fixedIdentity,
    action: 'POST /api/keys',
    ttlSeconds: 120,
    audience: ['traefik', 'elysia'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.expiresAt, '2024-01-01T00:02:00.000Z');

  const decoded = decodeJwt(result.value.token);
  assert.deepEqual(decoded.payload.aud, ['traefik', 'elysia']);
  assert.equal(decoded.payload.exp, 1704067320);
});

test('rejects blank actions with a domain error', async () => {
  const service = buildService();
  const result = await service.mintDecisionJwt({
    identity: fixedIdentity,
    action: '   ',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'token.invalid_action');
});

test('supports EdDSA signing via createTokenService factory', async () => {
  const service = createTokenService({
    issuer: 'https://auth.catalyst.test',
    decision: {
      signer: {
        algorithm: 'EdDSA',
        privateKey: edPrivatePem,
        keyId: 'ed25519-test',
      },
      defaultTtlSeconds: 60,
    },
    now: nowFn,
    jtiFactory: () => 'ed-jti',
  });

  const result = await service.mintDecisionJwt({
    identity: fixedIdentity,
    action: 'GET /traefik',
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.expiresAt, '2024-01-01T00:01:00.000Z');

  const decoded = decodeJwt(result.value.token);
  assert.equal(decoded.header.alg, 'EdDSA');
  assert.equal(decoded.header.kid, 'ed25519-test');
  assert.equal(typeof decoded.signature, 'string');
  assert.notEqual(decoded.signature.length, 0);
});

test('does not leak mutable identity references', async () => {
  const mutableIdentity = {
    ...fixedIdentity,
    groups: [...fixedIdentity.groups],
    roles: [...fixedIdentity.roles],
    entitlements: [...fixedIdentity.entitlements],
    scopes: [...fixedIdentity.scopes],
    labels: { ...fixedIdentity.labels },
  };
  const service = buildService();
  const result = await service.mintDecisionJwt({
    identity: mutableIdentity,
    action: 'GET /immutable',
  });

  assert.equal(result.ok, true);
  const decoded = decodeJwt(result.value.token);

  mutableIdentity.groups.push('new-group');
  mutableIdentity.labels.plan = 'enterprise';

  assert.deepEqual(decoded.payload.groups, ['engineering']);
  assert.deepEqual(decoded.payload.labels, { plan: 'pro', region: 'us' });
});

test('mints access tokens with scopes and metadata', async () => {
  const service = buildService();
  const result = await service.mintAccessToken({
    subject: 'user-123',
    clientId: 'cli-1',
    scopes: ['read', 'write'],
    orgId: 'org-9',
    sessionId: 'sess-8',
    metadata: { ip: '127.0.0.1' },
  });

  assert.equal(result.ok, true);
  const decoded = decodeJwt(result.value.token);
  assert.equal(decoded.payload.iss, 'https://auth.catalyst.test');
  assert.equal(decoded.payload.sub, 'user-123');
  assert.equal(decoded.payload.client_id, 'cli-1');
  assert.equal(decoded.payload.token_type, 'access');
  assert.equal(decoded.payload.org, 'org-9');
  assert.equal(decoded.payload.session, 'sess-8');
  assert.equal(decoded.payload.scope, 'read write');
  assert.deepEqual(decoded.payload.metadata, { ip: '127.0.0.1' });
});

test('mints refresh tokens with session references', async () => {
  const service = buildService();
  const result = await service.mintRefreshToken({
    subject: 'user-123',
    clientId: 'cli-1',
    sessionId: 'sess-9',
  });

  assert.equal(result.ok, true);
  const decoded = decodeJwt(result.value.token);
  assert.equal(decoded.payload.token_type, 'refresh');
  assert.equal(decoded.payload.session, 'sess-9');
});

test('mints coordinated token pairs', async () => {
  const service = buildService();
  const result = await service.mintTokenPair(
    {
      subject: 'user-789',
      clientId: 'cli-2',
      scopes: ['read'],
    },
    {
      subject: 'user-789',
      clientId: 'cli-2',
    },
  );

  assert.equal(result.ok, true);
  assert.ok(result.value.accessToken.includes('.'));
  assert.ok(result.value.refreshToken.includes('.'));
  assert.equal(typeof result.value.expiresAt, 'string');
});
