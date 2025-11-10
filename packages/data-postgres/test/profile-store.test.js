import assert from "node:assert/strict";
import test from "node:test";

import { createTestPostgresDataSource } from "../dist/testing/test-data-source.js";

const exampleUser = {
  id: "user-1",
  authentikId: "auth-1",
  email: "user@example.com",
  labels: { plan: "pro" },
  metadata: { locale: "en" },
};

test("stores and retrieves profiles, memberships, and effective identities", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { profileStore, entitlementStore } = dataSource;

  const user = await profileStore.upsertUserProfile({
    ...exampleUser,
    primaryOrgId: "org-1",
  });
  assert.equal(user.id, "user-1");
  assert.equal((await profileStore.getUserProfile("user-1"))?.email, "user@example.com");

  await profileStore.upsertOrgProfile({
    id: "org-1",
    slug: "acme",
    status: "active",
    ownerUserId: "user-1",
    profile: { name: "Acme" },
    labels: { segment: "enterprise" },
    settings: {},
  });

  const orgBySlug = await profileStore.getOrgProfileBySlug("acme");
  assert.equal(orgBySlug?.id, "org-1");

  await profileStore.upsertGroup({
    id: "group-1",
    orgId: "org-1",
    slug: "engineering",
    name: "Engineering",
    labels: { department: "eng" },
  });

  await profileStore.upsertMembership({
    id: "m-1",
    userId: "user-1",
    orgId: "org-1",
    role: "admin",
    groupIds: ["group-1"],
    labelsDelta: { region: "emea" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  await entitlementStore.upsertEntitlement({
    id: "ent-1",
    subjectKind: "user",
    subjectId: "user-1",
    entitlement: "feature:user-dashboard",
    createdAt: "2024-01-01T00:00:00.000Z",
  });

  await entitlementStore.upsertEntitlement({
    id: "ent-2",
    subjectKind: "org",
    subjectId: "org-1",
    entitlement: "feature:org-insights",
    createdAt: "2024-01-02T00:00:00.000Z",
  });

  await entitlementStore.upsertEntitlement({
    id: "ent-3",
    subjectKind: "membership",
    subjectId: "m-1",
    entitlement: "feature:billing",
    createdAt: "2024-01-03T00:00:00.000Z",
  });

  const membershipsByUser = await profileStore.listMembershipsByUser("user-1");
  assert.equal(membershipsByUser.length, 1);

  const identity = await profileStore.computeEffectiveIdentity({ userId: "user-1" });
  assert.equal(identity.userId, "user-1");
  assert.equal(identity.orgId, "org-1");
  assert.deepEqual(identity.groups, ["group-1"]);
  assert.equal(identity.roles[0], "admin");
  assert.equal(identity.labels.plan, "pro");
  assert.equal(identity.labels.segment, "enterprise");
  assert.equal(identity.labels.region, "emea");
  assert.equal(identity.labels.department, "eng");
  assert.deepEqual(identity.entitlements, [
    "feature:user-dashboard",
    "feature:org-insights",
    "feature:billing",
  ]);
});

test("validates memberships when computing identities", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { profileStore } = dataSource;

  await profileStore.upsertUserProfile({
    ...exampleUser,
    primaryOrgId: "org-1",
  });

  await profileStore.upsertOrgProfile({
    id: "org-1",
    slug: "acme",
    status: "active",
    ownerUserId: "user-1",
    profile: { name: "Acme" },
    labels: {},
    settings: {},
  });

  await profileStore.upsertMembership({
    id: "m-1",
    userId: "user-1",
    orgId: "org-1",
    role: "member",
    groupIds: [],
    labelsDelta: {},
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  await assert.rejects(
    () => profileStore.computeEffectiveIdentity({ userId: "missing" }),
    /User profile missing not found/,
  );

  await assert.rejects(
    () => profileStore.computeEffectiveIdentity({ userId: "user-1", membershipId: "missing" }),
    /Membership missing not found/,
  );

  await assert.rejects(
    () =>
      profileStore.computeEffectiveIdentity({
        userId: "user-1",
        membershipId: "m-1",
        orgId: "other",
      }),
    /does not belong to org other/,
  );
});

test("profile mutations invalidate decision and identity caches", async () => {
  const decisionCache = createCacheCollector();
  const identityCache = createCacheCollector();
  const dataSource = await createTestPostgresDataSource(undefined, {
    cacheOptions: {
      decisionCache,
      effectiveIdentityCache: identityCache,
    },
  });
  const { profileStore } = dataSource;

  await profileStore.upsertUserProfile({
    ...exampleUser,
    primaryOrgId: "org-1",
  });

  await profileStore.upsertOrgProfile({
    id: "org-1",
    slug: "acme",
    status: "active",
    ownerUserId: "user-1",
    profile: { name: "Acme" },
    labels: {},
    settings: {},
  });

  assert.ok(decisionCache.tags.includes("decision:org:org-1"));
  assert.ok(identityCache.tags.includes("effective-identity:org:org-1"));

  decisionCache.tags.length = 0;
  identityCache.tags.length = 0;

  await profileStore.upsertGroup({
    id: "group-1",
    orgId: "org-1",
    slug: "engineering",
    name: "Engineering",
    labels: {},
  });

  await profileStore.upsertMembership({
    id: "m-1",
    userId: "user-1",
    orgId: "org-1",
    role: "admin",
    groupIds: ["group-1"],
    labelsDelta: {},
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  });

  assert.ok(decisionCache.tags.includes("decision:user:user-1"));
  assert.ok(decisionCache.tags.includes("decision:org:org-1"));
  assert.ok(decisionCache.tags.includes("decision:group:group-1"));
  assert.ok(identityCache.tags.includes("effective-identity:user:user-1"));
  assert.ok(identityCache.tags.includes("effective-identity:membership:m-1"));
  assert.ok(identityCache.tags.includes("effective-identity:group:group-1"));

  decisionCache.tags.length = 0;
  identityCache.tags.length = 0;

  await profileStore.removeMembership("m-1");

  assert.ok(decisionCache.tags.includes("decision:user:user-1"));
  assert.ok(identityCache.tags.includes("effective-identity:membership:m-1"));
});

const createCacheCollector = () => {
  const tags = [];
  return {
    tags,
    async get() {
      return undefined;
    },
    async set() {},
    async delete() {},
    async purgeByTag(tag) {
      tags.push(tag);
    },
    async clear() {},
  };
};
