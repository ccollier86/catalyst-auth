import assert from "node:assert/strict";
import test from "node:test";

import { createTestPostgresDataSource } from "../dist/testing/test-data-source.js";

test("creates, updates, and deletes sessions", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { sessionStore } = dataSource;

  await sessionStore.createSession({
    id: "sess-1",
    userId: "user-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    lastSeenAt: "2024-01-01T00:00:00.000Z",
    factorsVerified: ["password"],
    metadata: { ip: "1.1.1.1" },
  });

  const byUser = await sessionStore.listSessionsByUser("user-1");
  assert.equal(byUser.length, 1);
  assert.equal(byUser[0].id, "sess-1");

  const updated = await sessionStore.touchSession("sess-1", {
    lastSeenAt: "2024-01-02T00:00:00.000Z",
    factorsVerified: ["password", "webauthn"],
    metadata: { ip: "2.2.2.2" },
  });
  assert.equal(updated.lastSeenAt, "2024-01-02T00:00:00.000Z");
  assert.deepEqual(updated.factorsVerified, ["password", "webauthn"]);
  assert.equal(updated.metadata?.ip, "2.2.2.2");

  await sessionStore.deleteSession("sess-1");
  const afterDelete = await sessionStore.getSession("sess-1");
  assert.equal(afterDelete, undefined);
});
