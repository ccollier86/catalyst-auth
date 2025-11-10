import assert from "node:assert/strict";
import test from "node:test";

import { createTestPostgresDataSource } from "../dist/testing/test-data-source.js";

const unwrapOk = (result) => {
  assert.equal(result.ok, true, `Expected ok result but received error ${JSON.stringify(result.error)}`);
  return result.value;
};

test("issues, retrieves, updates, and revokes keys", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { keyStore } = dataSource;

  const owner = { kind: "user", id: "user-123" };
  const created = await keyStore.issueKey({
    hash: "hash-123",
    owner,
    name: "Primary",
    description: "Main key",
    scopes: ["read", "write"],
    labels: { tier: "gold" },
  });

  const record = unwrapOk(created);
  assert.equal(record.owner.id, owner.id);
  assert.equal(record.status, "active");
  assert.deepEqual(record.scopes.sort(), ["read", "write"]);
  assert.equal(record.usageCount, 0);

  const fetchedById = await keyStore.getKeyById(record.id);
  assert.equal(unwrapOk(fetchedById)?.id, record.id);

  const fetchedByHash = await keyStore.getKeyByHash("hash-123");
  assert.equal(unwrapOk(fetchedByHash)?.id, record.id);

  const listed = await keyStore.listKeysByOwner(owner);
  assert.equal(unwrapOk(listed).length, 1);

  const usage = await keyStore.recordKeyUsage(record.id, { usedAt: "2024-01-01T00:00:00.000Z" });
  assert.equal(unwrapOk(usage).usageCount, 1);
  assert.equal(unwrapOk(usage).lastUsedAt, "2024-01-01T00:00:00.000Z");

  const revoked = await keyStore.revokeKey(record.id, {
    revokedAt: "2024-01-02T00:00:00.000Z",
    reason: "rotated",
    revokedBy: { kind: "system", id: "rotator" },
  });
  const revokedRecord = unwrapOk(revoked);
  assert.equal(revokedRecord.status, "revoked");
  assert.equal(revokedRecord.revokedBy?.id, "rotator");
});

test("guards against duplicate ids and hashes", async () => {
  const dataSource = await createTestPostgresDataSource();
  const owner = { kind: "org", id: "org-1" };

  const first = await dataSource.keyStore.issueKey({
    id: "key-1",
    hash: "hash-1",
    owner,
    scopes: [],
  });
  unwrapOk(first);

  const duplicateId = await dataSource.keyStore.issueKey({
    id: "key-1",
    hash: "hash-2",
    owner,
    scopes: [],
  });
  assert.equal(duplicateId.ok, false);
  assert.equal(duplicateId.error.code, "key.postgres.duplicate_id");

  const duplicateHash = await dataSource.keyStore.issueKey({
    id: "key-2",
    hash: "hash-1",
    owner,
    scopes: [],
  });
  assert.equal(duplicateHash.ok, false);
  assert.equal(duplicateHash.error.code, "key.postgres.duplicate_hash");
});

test("filters revoked and expired keys based on options", async () => {
  const dataSource = await createTestPostgresDataSource();
  const owner = { kind: "service", id: "svc-1" };
  const now = new Date().toISOString();
  const past = "2023-01-01T00:00:00.000Z";

  await dataSource.seed({
    keys: [
      {
        id: "key-active",
        hash: "hash-active",
        owner,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
        status: "active",
        scopes: ["base"],
        labels: {},
      },
      {
        id: "key-revoked",
        hash: "hash-revoked",
        owner,
        createdAt: now,
        updatedAt: now,
        usageCount: 0,
        status: "revoked",
        scopes: [],
        labels: {},
        revokedAt: now,
        revokedBy: { kind: "system", id: "rotator" },
        revocationReason: "rotated",
      },
      {
        id: "key-expired",
        hash: "hash-expired",
        owner,
        createdAt: past,
        updatedAt: past,
        usageCount: 0,
        status: "active",
        scopes: [],
        labels: {},
        expiresAt: past,
      },
    ],
  });

  const activeOnly = unwrapOk(await dataSource.keyStore.listKeysByOwner(owner));
  assert.deepEqual(activeOnly.map((key) => key.id), ["key-active"]);

  const includeAll = unwrapOk(
    await dataSource.keyStore.listKeysByOwner(owner, { includeRevoked: true, includeExpired: true }),
  );
  assert.equal(includeAll.length, 3);
  const statuses = Object.fromEntries(includeAll.map((key) => [key.id, key.status]));
  assert.equal(statuses["key-revoked"], "revoked");
  assert.equal(statuses["key-expired"], "expired");
});
