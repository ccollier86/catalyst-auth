import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryProfileStore, createInMemoryProfileStore } from '../dist/index.js';

const baseUser = {
  id: 'user-1',
  authentikId: 'ak-user-1',
  email: 'user@example.com',
  primaryOrgId: 'org-1',
  displayName: 'User One',
  avatarUrl: 'https://example.com/avatar.png',
  labels: { plan: 'free', region: 'na' },
  metadata: { timezone: 'UTC' },
};

const baseOrg = {
  id: 'org-1',
  slug: 'org-one',
  status: 'active',
  ownerUserId: 'user-1',
  profile: {
    name: 'Org One',
    logoUrl: 'https://example.com/logo.png',
    description: 'Test org',
    websiteUrl: 'https://example.com',
    brandColors: { primary: '#fff' },
    address: { country: 'US' },
    links: { support: 'https://example.com/support' },
  },
  labels: { plan: 'team', region: 'us' },
  settings: { forwardAuth: true },
};

const baseMembership = {
  id: 'm-1',
  userId: 'user-1',
  orgId: 'org-1',
  role: 'admin',
  groupIds: [],
  labelsDelta: { plan: 'admin', seatLimit: 5 },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const baseGroup = {
  id: 'group-1',
  orgId: 'org-1',
  slug: 'engineering',
  name: 'Engineering',
  description: 'Eng team',
  labels: { cohort: 'beta', plan: 'group' },
};

test('upsert operations clone stored user and org profiles', async () => {
  const store = new InMemoryProfileStore();

  const storedUser = await store.upsertUserProfile(baseUser);
  assert.notStrictEqual(storedUser, baseUser);
  assert.deepEqual(storedUser, baseUser);

  const fetchedUser = await store.getUserProfile(baseUser.id);
  fetchedUser.labels.plan = 'modified';

  const userAfterMutation = await store.getUserProfile(baseUser.id);
  assert.equal(userAfterMutation.labels.plan, 'free');

  const storedOrg = await store.upsertOrgProfile(baseOrg);
  assert.notStrictEqual(storedOrg, baseOrg);
  assert.deepEqual(storedOrg, baseOrg);

  const fetchedOrg = await store.getOrgProfileBySlug(baseOrg.slug);
  assert.ok(fetchedOrg);
  fetchedOrg.labels.region = 'eu';

  const orgAfterMutation = await store.getOrgProfile(baseOrg.id);
  assert.equal(orgAfterMutation.labels.region, 'us');
});

test('membership indexes update on insert and removal', async () => {
  const store = createInMemoryProfileStore();

  await store.upsertUserProfile(baseUser);
  await store.upsertOrgProfile(baseOrg);

  const membership = { ...baseMembership, groupIds: ['group-1'] };
  await store.upsertMembership(membership);

  const byUser = await store.listMembershipsByUser(baseUser.id);
  assert.equal(byUser.length, 1);
  assert.deepEqual(byUser[0], membership);

  const byOrg = await store.listMembershipsByOrg(baseOrg.id);
  assert.equal(byOrg.length, 1);
  assert.deepEqual(byOrg[0], membership);

  await store.removeMembership(membership.id);

  const afterRemovalUser = await store.listMembershipsByUser(baseUser.id);
  const afterRemovalOrg = await store.listMembershipsByOrg(baseOrg.id);
  assert.equal(afterRemovalUser.length, 0);
  assert.equal(afterRemovalOrg.length, 0);
});

test('deleting a group unlinks it from org and memberships', async () => {
  const store = createInMemoryProfileStore();

  await store.upsertUserProfile(baseUser);
  await store.upsertOrgProfile(baseOrg);
  await store.upsertGroup(baseGroup);

  const membership = {
    ...baseMembership,
    groupIds: ['group-1'],
  };
  await store.upsertMembership(membership);

  const groupsBefore = await store.listGroups(baseOrg.id);
  assert.equal(groupsBefore.length, 1);

  await store.deleteGroup(baseGroup.id);

  const groupsAfter = await store.listGroups(baseOrg.id);
  assert.equal(groupsAfter.length, 0);

  const memberships = await store.listMembershipsByOrg(baseOrg.id);
  assert.equal(memberships.length, 1);
  assert.deepEqual(memberships[0].groupIds, []);
});

test('computeEffectiveIdentity merges labels, dedupes groups, and respects flags', async () => {
  const store = createInMemoryProfileStore();

  await store.upsertUserProfile(baseUser);
  await store.upsertOrgProfile({
    ...baseOrg,
    labels: { plan: 'org', tier: 'gold', region: 'us' },
  });

  await store.upsertGroup(baseGroup);
  await store.upsertGroup({
    id: 'group-2',
    orgId: 'org-1',
    slug: 'product',
    name: 'Product',
    labels: { plan: 'group-2', featureFlag: true },
  });

  const membership = {
    ...baseMembership,
    groupIds: ['group-1', 'group-1', 'group-2', 'missing-group'],
    labelsDelta: { plan: 'membership', seatLimit: 10 },
  };
  await store.upsertMembership(membership);

  const identity = await store.computeEffectiveIdentity({ userId: baseUser.id });
  assert.equal(identity.userId, baseUser.id);
  assert.equal(identity.orgId, baseOrg.id);
  assert.deepEqual(identity.roles, ['admin']);
  assert.deepEqual(identity.groups, ['group-1', 'group-2']);
  assert.deepEqual(identity.labels, {
    plan: 'group-2',
    region: 'us',
    seatLimit: 10,
    cohort: 'beta',
    featureFlag: true,
    tier: 'gold',
  });

  const noGroupsIdentity = await store.computeEffectiveIdentity({
    userId: baseUser.id,
    includeGroups: false,
  });
  assert.deepEqual(noGroupsIdentity.groups, []);
  assert.deepEqual(noGroupsIdentity.labels, {
    plan: 'membership',
    region: 'us',
    seatLimit: 10,
    tier: 'gold',
  });

  const explicitMembership = await store.computeEffectiveIdentity({
    userId: baseUser.id,
    membershipId: membership.id,
    orgId: baseOrg.id,
  });
  assert.equal(explicitMembership.orgId, baseOrg.id);
});

test('computeEffectiveIdentity throws for missing or mismatched entities', async () => {
  const store = createInMemoryProfileStore();
  await store.upsertUserProfile(baseUser);
  await store.upsertOrgProfile(baseOrg);
  await store.upsertMembership(baseMembership);

  await assert.rejects(
    store.computeEffectiveIdentity({ userId: 'missing-user' }),
    /User profile missing-user not found/,
  );

  await store.upsertUserProfile({
    ...baseUser,
    id: 'user-2',
    authentikId: 'ak-user-2',
    email: 'user2@example.com',
    primaryOrgId: undefined,
    labels: { plan: 'free' },
  });

  await assert.rejects(
    store.computeEffectiveIdentity({ userId: 'user-2', membershipId: baseMembership.id }),
    /does not belong to user user-2/,
  );

  await store.upsertOrgProfile({
    ...baseOrg,
    id: 'org-2',
    slug: 'org-two',
  });

  await assert.rejects(
    store.computeEffectiveIdentity({
      userId: baseUser.id,
      membershipId: baseMembership.id,
      orgId: 'org-2',
    }),
    /does not belong to org org-2/,
  );
});
