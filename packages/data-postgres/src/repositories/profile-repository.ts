import type {
  EffectiveIdentity,
  EffectiveIdentityRequest,
  GroupRecord,
  LabelSet,
  MembershipRecord,
  OrgProfileRecord,
  ProfileStorePort,
  UserProfileRecord,
} from "@catalyst-auth/contracts";

import { InMemoryPostgresDatabase } from "../testing/in-memory-database.js";
import { clone } from "../utils/clone.js";

const mergeLabelSets = (...sets: ReadonlyArray<LabelSet | undefined>): LabelSet => {
  const merged: Record<string, LabelSet[keyof LabelSet]> = {};
  for (const set of sets) {
    if (!set) {
      continue;
    }
    for (const [key, value] of Object.entries(set)) {
      merged[key] = value;
    }
  }
  return merged;
};

const dedupe = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};

const defaultDatabase = new InMemoryPostgresDatabase();

export class PostgresProfileStore implements ProfileStorePort {
  constructor(private readonly database: InMemoryPostgresDatabase = defaultDatabase) {}

  async getUserProfile(id: string): Promise<UserProfileRecord | undefined> {
    const user = this.database.users.get(id);
    return user ? clone(user) : undefined;
  }

  async upsertUserProfile(profile: UserProfileRecord): Promise<UserProfileRecord> {
    return this.database.saveUser(profile);
  }

  async getOrgProfile(id: string): Promise<OrgProfileRecord | undefined> {
    const org = this.database.orgs.get(id);
    return org ? clone(org) : undefined;
  }

  async getOrgProfileBySlug(slug: string): Promise<OrgProfileRecord | undefined> {
    const orgId = this.database.orgSlugIndex.get(slug);
    return orgId ? this.getOrgProfile(orgId) : undefined;
  }

  async upsertOrgProfile(profile: OrgProfileRecord): Promise<OrgProfileRecord> {
    return this.database.saveOrg(profile);
  }

  async listGroups(orgId: string): Promise<ReadonlyArray<GroupRecord>> {
    const groupIds = this.database.groupsByOrg.get(orgId);
    if (!groupIds) {
      return [];
    }
    return Array.from(groupIds)
      .map((id) => this.database.groups.get(id))
      .filter((group): group is GroupRecord => Boolean(group))
      .map((group) => clone(group));
  }

  async upsertGroup(group: GroupRecord): Promise<GroupRecord> {
    return this.database.saveGroup(group);
  }

  async deleteGroup(groupId: string): Promise<void> {
    this.database.deleteGroup(groupId);
  }

  async listMembershipsByUser(userId: string): Promise<ReadonlyArray<MembershipRecord>> {
    const ids = this.database.membershipsByUser.get(userId);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.database.memberships.get(id))
      .filter((membership): membership is MembershipRecord => Boolean(membership))
      .map((membership) => clone(membership));
  }

  async listMembershipsByOrg(orgId: string): Promise<ReadonlyArray<MembershipRecord>> {
    const ids = this.database.membershipsByOrg.get(orgId);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.database.memberships.get(id))
      .filter((membership): membership is MembershipRecord => Boolean(membership))
      .map((membership) => clone(membership));
  }

  async upsertMembership(membership: MembershipRecord): Promise<MembershipRecord> {
    return this.database.saveMembership(membership);
  }

  async removeMembership(membershipId: string): Promise<void> {
    this.database.deleteMembership(membershipId);
  }

  async computeEffectiveIdentity(request: EffectiveIdentityRequest): Promise<EffectiveIdentity> {
    const user = this.database.users.get(request.userId);
    if (!user) {
      throw new Error(`User profile ${request.userId} not found`);
    }

    const membership = this.resolveMembership(request);
    const orgId = request.orgId ?? membership?.orgId ?? user.primaryOrgId;
    const org = orgId ? this.database.orgs.get(orgId) : undefined;

    if (request.orgId && !org) {
      throw new Error(`Org profile ${request.orgId} not found`);
    }

    const labels = mergeLabelSets(
      user.labels,
      org?.labels,
      membership?.labelsDelta,
      ...(request.includeGroups === false
        ? []
        : this.collectGroupLabels(membership?.groupIds ?? [])),
    );

    const groups = request.includeGroups === false
      ? []
      : this.collectGroupIds(membership?.groupIds ?? []);

    const roles = membership ? [membership.role] : [];

    return {
      userId: user.id,
      orgId: org?.id,
      groups,
      labels,
      roles,
      entitlements: [],
      scopes: [],
    };
  }

  private resolveMembership(request: EffectiveIdentityRequest): MembershipRecord | undefined {
    if (request.membershipId) {
      const membership = this.database.memberships.get(request.membershipId);
      if (!membership) {
        throw new Error(`Membership ${request.membershipId} not found`);
      }
      if (membership.userId !== request.userId) {
        throw new Error(`Membership ${request.membershipId} does not belong to user ${request.userId}`);
      }
      if (request.orgId && membership.orgId !== request.orgId) {
        throw new Error(`Membership ${request.membershipId} does not belong to org ${request.orgId}`);
      }
      return membership;
    }

    const membershipIds = this.database.membershipsByUser.get(request.userId);
    if (!membershipIds || membershipIds.size === 0) {
      return undefined;
    }

    if (!request.orgId) {
      const firstId = membershipIds.values().next().value as string | undefined;
      return firstId ? this.database.memberships.get(firstId) : undefined;
    }

    for (const membershipId of membershipIds) {
      const membership = this.database.memberships.get(membershipId);
      if (membership && membership.orgId === request.orgId) {
        return membership;
      }
    }

    return undefined;
  }

  private collectGroupLabels(groupIds: ReadonlyArray<string>): ReadonlyArray<LabelSet> {
    return groupIds
      .map((id) => this.database.groups.get(id))
      .filter((group): group is GroupRecord => Boolean(group))
      .map((group) => group.labels);
  }

  private collectGroupIds(groupIds: ReadonlyArray<string>): ReadonlyArray<string> {
    const resolvedIds = groupIds
      .map((id) => (this.database.groups.has(id) ? id : undefined))
      .filter((id): id is string => Boolean(id));
    return dedupe(resolvedIds);
  }
}

export const createPostgresProfileStore = (
  database?: InMemoryPostgresDatabase,
): ProfileStorePort => new PostgresProfileStore(database);
