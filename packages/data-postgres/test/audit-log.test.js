import assert from "node:assert/strict";
import test from "node:test";

import { createTestPostgresDataSource } from "../dist/testing/test-data-source.js";

const unwrapOk = (result) => {
  assert.equal(result.ok, true, `Expected ok result but received error ${JSON.stringify(result.error)}`);
  return result.value;
};

test("appends and lists audit events", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { auditLog } = dataSource;

  const first = await auditLog.appendEvent({
    category: "forward_auth",
    action: "decision_cached",
    metadata: { source: "test" },
  });
  const second = await auditLog.appendEvent({
    category: "forward_auth",
    action: "decision_consumed",
    actor: { id: "user-1", kind: "user" },
    occurredAt: "2024-01-01T00:00:00.000Z",
  });

  assert.ok(unwrapOk(first).id);
  assert.equal(unwrapOk(second).occurredAt, "2024-01-01T00:00:00.000Z");

  const events = unwrapOk(await auditLog.listEvents());
  assert.equal(events.length, 2);
  assert.equal(events[0].action, "decision_consumed");
  assert.equal(events[1].metadata?.source, "test");
});

test("validates audit event input", async () => {
  const dataSource = await createTestPostgresDataSource();
  const invalidCategory = await dataSource.auditLog.appendEvent({ category: " ", action: "x" });
  assert.equal(invalidCategory.ok, false);
  assert.equal(invalidCategory.error.code, "audit.postgres.invalid_category");

  const invalidAction = await dataSource.auditLog.appendEvent({ category: "a", action: " " });
  assert.equal(invalidAction.ok, false);
  assert.equal(invalidAction.error.code, "audit.postgres.invalid_action");
});
