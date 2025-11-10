import {
  err,
  ok,
  type CatalystError,
  type GroupRecord,
  type MembershipRecord,
  type OrgProfileRecord,
  type Result,
} from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createNotFoundError, createValidationError } from "../shared/errors.js";
import { labelSetSchema } from "../shared/schemas.js";
import { safeParse } from "../shared/validation.js";

const orgStatusValues = ["active", "suspended", "invited", "archived"] as const;

const groupSchema: z.ZodType<GroupRecord> = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  parentGroupId: z.string().optional(),
  labels: labelSetSchema.default({}),
});

const orgProfileSchema: z.ZodType<OrgProfileRecord> = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  status: z.enum(orgStatusValues),
  ownerUserId: z.string().min(1),
  profile: z.object({
    name: z.string().min(1),
    logoUrl: z.string().url().optional(),
    description: z.string().optional(),
    websiteUrl: z.string().url().optional(),
    brandColors: labelSetSchema.optional(),
    address: z.record(z.unknown()).optional(),
    links: z.record(z.string()).optional(),
  }),
  labels: labelSetSchema.default({}),
  settings: z.record(z.unknown()).default({}),
});

const membershipSchema: z.ZodType<MembershipRecord> = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  orgId: z.string().min(1),
  role: z.string().min(1),
  groupIds: z.array(z.string()).default([]),
  labelsDelta: labelSetSchema.default({}),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

type GetOrgInput = {
  readonly orgId: string;
};

const getOrgSchema: z.ZodType<GetOrgInput> = z.object({
  orgId: z.string().min(1),
});

type GetOrgBySlugInput = {
  readonly slug: string;
};

const getOrgBySlugSchema: z.ZodType<GetOrgBySlugInput> = z.object({
  slug: z.string().min(1),
});

type UpsertOrgInput = {
  readonly org: OrgProfileRecord;
};

const upsertOrgSchema: z.ZodType<UpsertOrgInput> = z.object({
  org: orgProfileSchema,
});

type ListMembershipsInput = {
  readonly orgId: string;
};

const listMembershipsSchema: z.ZodType<ListMembershipsInput> = z.object({
  orgId: z.string().min(1),
});

type UpsertMembershipInput = {
  readonly membership: MembershipRecord;
};

const upsertMembershipSchema: z.ZodType<UpsertMembershipInput> = z.object({
  membership: membershipSchema,
});

type RemoveMembershipInput = {
  readonly membershipId: string;
};

const removeMembershipSchema: z.ZodType<RemoveMembershipInput> = z.object({
  membershipId: z.string().min(1),
});

type ListGroupsInput = {
  readonly orgId: string;
};

const listGroupsSchema: z.ZodType<ListGroupsInput> = z.object({
  orgId: z.string().min(1),
});

type UpsertGroupInput = {
  readonly group: GroupRecord;
};

const upsertGroupSchema: z.ZodType<UpsertGroupInput> = z.object({
  group: groupSchema,
});

type DeleteGroupInput = {
  readonly groupId: string;
};

const deleteGroupSchema: z.ZodType<DeleteGroupInput> = z.object({
  groupId: z.string().min(1),
});

/**
 * Organization and membership operations available from the Catalyst SDK.
 */
export interface OrgsModule {
  readonly getOrgById: (request: z.infer<typeof getOrgSchema>) => Promise<Result<OrgProfileRecord, CatalystError>>;
  readonly getOrgBySlug: (request: z.infer<typeof getOrgBySlugSchema>) => Promise<Result<OrgProfileRecord, CatalystError>>;
  readonly upsertOrg: (request: z.infer<typeof upsertOrgSchema>) => Promise<Result<OrgProfileRecord, CatalystError>>;
  readonly listMemberships: (
    request: z.infer<typeof listMembershipsSchema>,
  ) => Promise<Result<ReadonlyArray<MembershipRecord>, CatalystError>>;
  readonly upsertMembership: (
    request: z.infer<typeof upsertMembershipSchema>,
  ) => Promise<Result<MembershipRecord, CatalystError>>;
  readonly removeMembership: (request: z.infer<typeof removeMembershipSchema>) => Promise<Result<null, CatalystError>>;
  readonly listGroups: (
    request: z.infer<typeof listGroupsSchema>,
  ) => Promise<Result<ReadonlyArray<GroupRecord>, CatalystError>>;
  readonly upsertGroup: (request: z.infer<typeof upsertGroupSchema>) => Promise<Result<GroupRecord, CatalystError>>;
  readonly deleteGroup: (request: z.infer<typeof deleteGroupSchema>) => Promise<Result<null, CatalystError>>;
}

const createGetOrgById = (deps: CatalystSdkDependencies): OrgsModule["getOrgById"] => async (request) => {
  const parsed = safeParse(getOrgSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const org = await deps.profileStore.getOrgProfile(parsed.value.orgId);
  if (!org) {
    return err(createNotFoundError("Organization", { orgId: parsed.value.orgId }));
  }
  return ok(org);
};

const createGetOrgBySlug = (deps: CatalystSdkDependencies): OrgsModule["getOrgBySlug"] => async (request) => {
  const parsed = safeParse(getOrgBySlugSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const org = await deps.profileStore.getOrgProfileBySlug(parsed.value.slug);
  if (!org) {
    return err(createNotFoundError("Organization", { slug: parsed.value.slug }));
  }
  return ok(org);
};

const createUpsertOrg = (deps: CatalystSdkDependencies): OrgsModule["upsertOrg"] => async (request) => {
  const parsed = safeParse(upsertOrgSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const org = await deps.profileStore.upsertOrgProfile(parsed.value.org);
  return ok(org);
};

const createListMemberships = (deps: CatalystSdkDependencies): OrgsModule["listMemberships"] => async (request) => {
  const parsed = safeParse(listMembershipsSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const memberships = await deps.profileStore.listMembershipsByOrg(parsed.value.orgId);
  return ok(memberships);
};

const createUpsertMembership = (deps: CatalystSdkDependencies): OrgsModule["upsertMembership"] => async (request) => {
  const parsed = safeParse(upsertMembershipSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const membership = await deps.profileStore.upsertMembership(parsed.value.membership);
  return ok(membership);
};

const createRemoveMembership = (deps: CatalystSdkDependencies): OrgsModule["removeMembership"] => async (request) => {
  const parsed = safeParse(removeMembershipSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  await deps.profileStore.removeMembership(parsed.value.membershipId);
  return ok(null);
};

const createListGroups = (deps: CatalystSdkDependencies): OrgsModule["listGroups"] => async (request) => {
  const parsed = safeParse(listGroupsSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const groups = await deps.profileStore.listGroups(parsed.value.orgId);
  return ok(groups);
};

const createUpsertGroup = (deps: CatalystSdkDependencies): OrgsModule["upsertGroup"] => async (request) => {
  const parsed = safeParse(upsertGroupSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const group = await deps.profileStore.upsertGroup(parsed.value.group);
  return ok(group);
};

const createDeleteGroup = (deps: CatalystSdkDependencies): OrgsModule["deleteGroup"] => async (request) => {
  const parsed = safeParse(deleteGroupSchema, request, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  await deps.profileStore.deleteGroup(parsed.value.groupId);
  return ok(null);
};

/**
 * Creates the {@link OrgsModule} bound to the provided dependencies.
 */
export const createOrgsModule = (deps: CatalystSdkDependencies): OrgsModule => ({
  getOrgById: createGetOrgById(deps),
  getOrgBySlug: createGetOrgBySlug(deps),
  upsertOrg: createUpsertOrg(deps),
  listMemberships: createListMemberships(deps),
  upsertMembership: createUpsertMembership(deps),
  removeMembership: createRemoveMembership(deps),
  listGroups: createListGroups(deps),
  upsertGroup: createUpsertGroup(deps),
  deleteGroup: createDeleteGroup(deps),
});
