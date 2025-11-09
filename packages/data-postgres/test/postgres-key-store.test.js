import test from 'node:test';
import assert from 'node:assert/strict';

import { PostgresKeyStore, createPostgresKeyStore } from '../dist/index.js';

class StubQueryable {
  constructor() {
    this.calls = [];
    this.responses = [];
  }

  queueResult(rows) {
    this.responses.push(async () => ({ rows }));
  }

  queueError(error) {
    this.responses.push(async () => {
      throw error;
    });
  }

  async query(sql, params = []) {
    this.calls.push({ sql, params });
    if (this.responses.length === 0) {
      throw new Error('No response configured for query');
    }
    const responder = this.responses.shift();
    return responder(sql, params);
  }
}

const fixedClock = (iso = '2024-01-01T00:00:00.000Z') => ({
  now: () => new Date(iso),
});

const baseRow = {
  id: 'key-1',
  hash: 'hash-1',
  name: null,
  description: null,
  ownerKind: 'user',
  ownerId: 'user-1',
  createdByKind: null,
  createdById: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
  usageCount: 0,
  status: 'active',
  scopes: ['read'],
  labels: { tier: 'pro' },
  metadata: { note: 'seed' },
  revokedAt: null,
  revokedByKind: null,
  revokedById: null,
  revocationReason: null,
};

const makeRow = (overrides = {}) => ({
  ...baseRow,
  ...overrides,
});

test('issues keys and returns immutable records', async () => {
  const queryable = new StubQueryable();
  const row = makeRow({
    id: 'generated-1',
    hash: 'hash-issue',
    createdAt: '2024-05-01T00:00:00.000Z',
    updatedAt: '2024-05-01T00:00:00.000Z',
  });
  queryable.queueResult([row]);

  const clock = fixedClock('2024-05-01T00:00:00.000Z');
  const store = new PostgresKeyStore({
    queryable,
    clock,
    idFactory: () => 'generated-1',
  });

  const result = await store.issueKey({
    hash: 'hash-issue',
    owner: { kind: 'user', id: 'user-1' },
    scopes: ['read', 'read'],
    labels: { tier: 'pro' },
    metadata: { note: 'seed' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'generated-1');
  assert.equal(result.value.status, 'active');
  assert.deepEqual(result.value.scopes, ['read']);
  assert.deepEqual(result.value.labels, { tier: 'pro' });

  assert.equal(queryable.calls.length, 1);
  const call = queryable.calls[0];
  assert.ok(call.sql.includes('INSERT INTO catalyst_keys'));
  assert.deepEqual(call.params, [
    'generated-1',
    'hash-issue',
    'user',
    'user-1',
    null,
    null,
    null,
    null,
    '2024-05-01T00:00:00.000Z',
    '2024-05-01T00:00:00.000Z',
    null,
    ['read'],
    { tier: 'pro' },
    { note: 'seed' },
  ]);

  result.value.labels.tier = 'enterprise';
  assert.equal(row.labels.tier, 'pro');
});

test('maps duplicate hash errors when issuing keys', async () => {
  const queryable = new StubQueryable();
  queryable.queueError({ code: '23505', constraint: 'catalyst_keys_hash_key' });

  const store = new PostgresKeyStore({
    queryable,
    clock: fixedClock(),
    idFactory: () => 'generated-1',
  });

  const result = await store.issueKey({
    hash: 'hash-1',
    owner: { kind: 'user', id: 'user-1' },
    scopes: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'key.postgres.duplicate_hash');
});

test('getKeyById returns undefined when missing', async () => {
  const queryable = new StubQueryable();
  queryable.queueResult([]);

  const store = createPostgresKeyStore({
    queryable,
    clock: fixedClock(),
  });

  const result = await store.getKeyById('missing');
  assert.equal(result.ok, true);
  assert.equal(result.value, undefined);
});

test('listKeysByOwner filters revoked and expired by default', async () => {
  const queryable = new StubQueryable();
  queryable.queueResult([
    makeRow({ id: 'key-2', scopes: ['read', 'write'] }),
  ]);

  const clock = fixedClock('2024-06-01T00:00:00.000Z');
  const store = createPostgresKeyStore({
    queryable,
    clock,
  });

  const result = await store.listKeysByOwner({ kind: 'org', id: 'org-1' });
  assert.equal(result.ok, true);
  assert.equal(queryable.calls.length, 1);
  const [call] = queryable.calls;
  assert.ok(call.sql.includes("status <> 'revoked'"));
  assert.ok(call.sql.includes('expires_at IS NULL OR expires_at > $3'));
  assert.deepEqual(call.params, ['org', 'org-1', '2024-06-01T00:00:00.000Z']);
  assert.equal(result.value.length, 1);
  assert.deepEqual(result.value[0].scopes, ['read', 'write']);
});

test('recordKeyUsage rejects revoked keys', async () => {
  const queryable = new StubQueryable();
  queryable.queueResult([
    makeRow({ status: 'revoked', revokedAt: '2024-01-02T00:00:00.000Z' }),
  ]);

  const store = createPostgresKeyStore({
    queryable,
    clock: fixedClock(),
  });

  const result = await store.recordKeyUsage('key-1');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'key.postgres.revoked');
  assert.equal(queryable.calls.length, 1);
});

test('recordKeyUsage updates timestamps and count', async () => {
  const queryable = new StubQueryable();
  queryable.queueResult([
    makeRow({ status: 'active', usageCount: 0, lastUsedAt: null }),
  ]);
  queryable.queueResult([
    makeRow({ usageCount: 1, lastUsedAt: '2024-07-01T00:00:01.000Z', updatedAt: '2024-07-01T00:00:01.000Z' }),
  ]);

  const store = createPostgresKeyStore({
    queryable,
    clock: fixedClock('2024-07-01T00:00:00.000Z'),
  });

  const result = await store.recordKeyUsage('key-1', {
    usedAt: '2024-07-01T00:00:01.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(queryable.calls.length, 2);
  const updateCall = queryable.calls[1];
  assert.ok(updateCall.sql.includes('UPDATE catalyst_keys'));
  assert.deepEqual(updateCall.params, ['key-1', '2024-07-01T00:00:01.000Z']);
  assert.equal(result.value.usageCount, 1);
  assert.equal(result.value.lastUsedAt, '2024-07-01T00:00:01.000Z');
});

test('revokeKey prevents double revocation', async () => {
  const queryable = new StubQueryable();
  queryable.queueResult([
    makeRow({ status: 'revoked', revokedAt: '2024-08-01T00:00:00.000Z' }),
  ]);

  const store = createPostgresKeyStore({
    queryable,
    clock: fixedClock(),
  });

  const result = await store.revokeKey('key-1');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'key.postgres.already_revoked');
});

test('revokeKey updates status and metadata', async () => {
  const queryable = new StubQueryable();
  queryable.queueResult([
    makeRow({ status: 'active' }),
  ]);
  queryable.queueResult([
    makeRow({
      status: 'revoked',
      revokedAt: '2024-09-01T00:00:00.000Z',
      revokedByKind: 'service',
      revokedById: 'svc-1',
      revocationReason: 'rotated',
    }),
  ]);

  const store = createPostgresKeyStore({
    queryable,
    clock: fixedClock('2024-09-01T00:00:00.000Z'),
  });

  const result = await store.revokeKey('key-1', {
    revokedBy: { kind: 'service', id: 'svc-1' },
    reason: 'rotated',
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'revoked');
  assert.equal(result.value.revokedBy?.id, 'svc-1');
  assert.equal(queryable.calls.length, 2);
  assert.ok(queryable.calls[1].sql.includes("SET status = 'revoked'"));
});

test('rejects invalid table names', () => {
  const queryable = new StubQueryable();
  assert.throws(
    () =>
      new PostgresKeyStore({
        queryable,
        tableName: 'invalid-table-name',
      }),
    /Invalid Postgres table name/,
  );
});
