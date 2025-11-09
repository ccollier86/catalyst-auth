import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryKeyStore, MemoryKeyStore } from '../dist/index.js';

const userOwner = { kind: 'user', id: 'user-1' };
const serviceOwner = { kind: 'service', id: 'svc-1' };

const fixedClock = (initial) => {
  let current = typeof initial === 'string' ? new Date(initial) : new Date(initial ?? Date.now());
  return {
    now: () => new Date(current),
    set(value) {
      current = typeof value === 'string' ? new Date(value) : new Date(value);
    },
  };
};

test('issues keys with generated ids and clones returned data', async () => {
  const clock = fixedClock('2024-01-01T00:00:00.000Z');
  let generated = 0;
  const store = new MemoryKeyStore({
    clock,
    idFactory: () => `generated-${++generated}`,
  });

  const result = await store.issueKey({
    hash: 'hash-1',
    owner: userOwner,
    scopes: ['read', 'read'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.id, 'generated-1');
  assert.equal(result.value.status, 'active');
  assert.equal(result.value.usageCount, 0);
  assert.deepEqual(result.value.scopes, ['read']);
  assert.deepEqual(result.value.labels, {});

  result.value.labels.level = 'pro';
  result.value.scopes.push('write');

  const secondFetch = await store.getKeyById('generated-1');
  assert.equal(secondFetch.ok, true);
  assert.deepEqual(secondFetch.value.labels, {});
  assert.deepEqual(secondFetch.value.scopes, ['read']);
});

test('guards against duplicate ids and hashes', async () => {
  const store = createMemoryKeyStore();

  const first = await store.issueKey({
    id: 'key-1',
    hash: 'hash-1',
    owner: userOwner,
    scopes: ['read'],
  });
  assert.equal(first.ok, true);

  const duplicateId = await store.issueKey({
    id: 'key-1',
    hash: 'hash-2',
    owner: userOwner,
    scopes: ['read'],
  });
  assert.equal(duplicateId.ok, false);
  assert.equal(duplicateId.error.code, 'key.memory.duplicate_id');

  const duplicateHash = await store.issueKey({
    id: 'key-2',
    hash: 'hash-1',
    owner: userOwner,
    scopes: ['read'],
  });
  assert.equal(duplicateHash.ok, false);
  assert.equal(duplicateHash.error.code, 'key.memory.duplicate_hash');
});

test('reflects expiration state when fetching keys', async () => {
  const clock = fixedClock('2024-01-01T00:00:00.000Z');
  const store = new MemoryKeyStore({ clock });

  const issued = await store.issueKey({
    id: 'expiring',
    hash: 'hash-expiring',
    owner: userOwner,
    scopes: ['read'],
    expiresAt: '2024-01-02T00:00:00.000Z',
  });
  assert.equal(issued.ok, true);
  assert.equal(issued.value.status, 'active');

  clock.set('2024-01-03T00:00:00.000Z');

  const fetched = await store.getKeyById('expiring');
  assert.equal(fetched.ok, true);
  assert.equal(fetched.value.status, 'expired');
});

test('lists keys per owner with optional revoked/expired inclusion', async () => {
  const clock = fixedClock('2024-01-01T00:00:00.000Z');
  const store = new MemoryKeyStore({ clock });

  const active = await store.issueKey({
    id: 'active-key',
    hash: 'hash-active',
    owner: userOwner,
    scopes: ['read'],
  });
  assert.equal(active.ok, true);

  const expiring = await store.issueKey({
    id: 'expired-key',
    hash: 'hash-expired',
    owner: userOwner,
    scopes: ['read'],
    expiresAt: '2024-01-01T12:00:00.000Z',
  });
  assert.equal(expiring.ok, true);

  const otherOwner = await store.issueKey({
    id: 'other-owner',
    hash: 'hash-other',
    owner: serviceOwner,
    scopes: ['read'],
  });
  assert.equal(otherOwner.ok, true);

  const revoke = await store.issueKey({
    id: 'revoked-key',
    hash: 'hash-revoked',
    owner: userOwner,
    scopes: ['write'],
  });
  assert.equal(revoke.ok, true);
  const revoked = await store.revokeKey('revoked-key', { reason: 'rotated' });
  assert.equal(revoked.ok, true);

  clock.set('2024-01-02T00:00:00.000Z');

  const defaultList = await store.listKeysByOwner(userOwner);
  assert.equal(defaultList.ok, true);
  assert.deepEqual(defaultList.value.map((k) => k.id), ['active-key']);

  const withExpired = await store.listKeysByOwner(userOwner, { includeExpired: true });
  assert.equal(withExpired.ok, true);
  assert.deepEqual(withExpired.value.map((k) => k.id).sort(), ['active-key', 'expired-key']);

  const withRevoked = await store.listKeysByOwner(userOwner, {
    includeRevoked: true,
    includeExpired: true,
  });
  assert.equal(withRevoked.ok, true);
  assert.deepEqual(withRevoked.value.map((k) => k.id).sort(), [
    'active-key',
    'expired-key',
    'revoked-key',
  ]);

  const otherList = await store.listKeysByOwner(serviceOwner);
  assert.equal(otherList.ok, true);
  assert.deepEqual(otherList.value.map((k) => k.id), ['other-owner']);
});

test('records usage timestamps and prevents updates for invalid states', async () => {
  const clock = fixedClock('2024-01-01T00:00:00.000Z');
  const store = new MemoryKeyStore({ clock });

  const issued = await store.issueKey({
    id: 'usage-key',
    hash: 'hash-usage',
    owner: userOwner,
    scopes: ['read'],
  });
  assert.equal(issued.ok, true);

  const firstUsage = await store.recordKeyUsage('usage-key', {
    usedAt: '2024-01-01T08:30:00.000Z',
  });
  assert.equal(firstUsage.ok, true);
  assert.equal(firstUsage.value.usageCount, 1);
  assert.equal(firstUsage.value.lastUsedAt, '2024-01-01T08:30:00.000Z');
  assert.equal(firstUsage.value.updatedAt, '2024-01-01T08:30:00.000Z');

  clock.set('2024-01-02T09:00:00.000Z');
  const secondUsage = await store.recordKeyUsage('usage-key');
  assert.equal(secondUsage.ok, true);
  assert.equal(secondUsage.value.usageCount, 2);
  assert.equal(secondUsage.value.lastUsedAt, '2024-01-02T09:00:00.000Z');

  const revoked = await store.revokeKey('usage-key', { reason: 'compromised' });
  assert.equal(revoked.ok, true);

  const usageAfterRevoke = await store.recordKeyUsage('usage-key');
  assert.equal(usageAfterRevoke.ok, false);
  assert.equal(usageAfterRevoke.error.code, 'key.memory.revoked');

  const expiredKey = await store.issueKey({
    id: 'expired-usage',
    hash: 'hash-expired-usage',
    owner: userOwner,
    scopes: ['read'],
    expiresAt: '2024-01-01T00:00:00.000Z',
  });
  assert.equal(expiredKey.ok, true);

  clock.set('2024-01-03T00:00:00.000Z');
  const usageAfterExpiry = await store.recordKeyUsage('expired-usage');
  assert.equal(usageAfterExpiry.ok, false);
  assert.equal(usageAfterExpiry.error.code, 'key.memory.expired');
});

test('revokes keys with metadata and blocks double revocation', async () => {
  const clock = fixedClock('2024-01-01T00:00:00.000Z');
  const store = new MemoryKeyStore({ clock });

  const issued = await store.issueKey({
    id: 'revokable',
    hash: 'hash-revokable',
    owner: userOwner,
    scopes: ['read'],
  });
  assert.equal(issued.ok, true);

  clock.set('2024-01-05T00:00:00.000Z');
  const revoked = await store.revokeKey('revokable', {
    reason: 'rotated',
    revokedBy: { kind: 'system', id: 'rotator' },
  });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.value.status, 'revoked');
  assert.equal(revoked.value.revocationReason, 'rotated');
  assert.deepEqual(revoked.value.revokedBy, { kind: 'system', id: 'rotator' });

  const second = await store.revokeKey('revokable');
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'key.memory.already_revoked');
});

test('seeds initial keys and preserves immutability across reads', async () => {
  const initial = {
    id: 'seeded',
    hash: 'hash-seeded',
    owner: userOwner,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    usageCount: 0,
    status: 'revoked',
    scopes: ['read'],
    labels: { plan: 'enterprise' },
    metadata: { source: 'import' },
    revokedAt: '2024-01-02T00:00:00.000Z',
    revokedBy: { kind: 'user', id: 'admin' },
    revocationReason: 'manual',
  };
  const store = new MemoryKeyStore({
    initialKeys: [initial],
  });

  const byHash = await store.getKeyByHash('hash-seeded');
  assert.equal(byHash.ok, true);
  assert.equal(byHash.value?.id, 'seeded');
  assert.equal(byHash.value?.status, 'revoked');

  byHash.value.labels.plan = 'free';
  const refetched = await store.getKeyById('seeded');
  assert.equal(refetched.ok, true);
  assert.equal(refetched.value.labels.plan, 'enterprise');
});
