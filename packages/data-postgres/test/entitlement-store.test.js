import assert from "node:assert/strict";
import test from "node:test";

import { createTestPostgresDataSource } from "../dist/testing/test-data-source.js";

const baseEntitlement = {
  createdAt: "2024-01-01T00:00:00.000Z",
};

test("persists and queries entitlements by subject", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { entitlementStore } = dataSource;

  await entitlementStore.upsertEntitlement({
    id: "ent-user",
    subjectKind: "user",
    subjectId: "user-1",
    entitlement: "feature:alpha",
    ...baseEntitlement,
  });

  await entitlementStore.upsertEntitlement({
    id: "ent-org",
    subjectKind: "org",
    subjectId: "org-1",
    entitlement: "feature:beta",
    ...baseEntitlement,
  });

  await entitlementStore.upsertEntitlement({
    id: "ent-membership",
    subjectKind: "membership",
    subjectId: "m-1",
    entitlement: "feature:gamma",
    ...baseEntitlement,
  });

  const userEntitlements = await entitlementStore.listEntitlements({
    subjectKind: "user",
    subjectId: "user-1",
  });
  assert.equal(userEntitlements.length, 1);
  assert.equal(userEntitlements[0].entitlement, "feature:alpha");

  const combined = await entitlementStore.listEntitlementsForSubjects([
    { subjectKind: "user", subjectId: "user-1" },
    { subjectKind: "membership", subjectId: "m-1" },
  ]);
  assert.equal(combined.length, 2);
  assert.deepEqual(combined.map((record) => record.entitlement).sort(), [
    "feature:alpha",
    "feature:gamma",
  ]);

  await entitlementStore.removeEntitlement("ent-membership");
  const afterRemoval = await entitlementStore.listEntitlements({
    subjectKind: "membership",
    subjectId: "m-1",
  });
  assert.equal(afterRemoval.length, 0);
});
