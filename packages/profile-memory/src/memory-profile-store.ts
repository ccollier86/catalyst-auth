import type {
  EffectiveIdentity,
  LabelSet,
  ProfileStorePort,
  UserProfileRecord,
  OrgProfileRecord,
  MembershipRecord,
  GroupRecord,
  EffectiveIdentityRequest,
} from "@catalyst-auth/contracts";

export interface InMemoryProfileStoreOptions {
  readonly initialUsers?: ReadonlyArray<UserProfileRecord>;
  readonly initialOrgs?: ReadonlyArray<OrgProfileRecord>;
  readonly initialGroups?: ReadonlyArray<GroupRecord>;
  readonly initialMemberships?: ReadonlyArray<MembershipRecord>;
}

const structuredCloneFn: (<T>(value: T) => T) | undefined =
  (globalThis as unknown as { structuredClone?: <T>(value: T) => T }).structuredClone;

const clone = <T>(value: T): T => {
  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

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

export class InMemoryProfileStore implements ProfileStorePort {
  private readonly users = new Map<string, UserProfileRecord>();
  private readonly orgs = new Map<string, OrgProfileRecord>();
  private readonly orgSlugIndex = new Map<string, string>();
  private readonly groups = new Map<string, GroupRecord>();
  private readonly groupsByOrg = new Map<string, Set<string>>();
  private readonly memberships = new Map<string, MembershipRecord>();
  private readonly membershipsByUser = new Map<string, Set<string>>();
  private readonly membershipsByOrg = new Map<string, Set<string>>();

  constructor(options: InMemoryProfileStoreOptions = {}) {
    for (const user of options.initialUsers ?? []) {
      this.saveUserProfile(user);
    }
    for (const org of options.initialOrgs ?? []) {
      this.saveOrgProfile(org);
    }
    for (const group of options.initialGroups ?? []) {
      this.saveGroup(group);
    }
    for (const membership of options.initialMemberships ?? []) {
      this.saveMembership(membership);
    }
  }

  async getUserProfile(id: string): Promise<UserProfileRecord | undefined> {
    const user = this.users.get(id);
    return user ? clone(user) : undefined;
  }

  async upsertUserProfile(profile: UserProfileRecord): Promise<UserProfileRecord> {
    const stored = this.saveUserProfile(profile);
    return clone(stored);
  }

  async getOrgProfile(id: string): Promise<OrgProfileRecord | undefined> {
    const org = this.orgs.get(id);
    return org ? clone(org) : undefined;
  }

  async getOrgProfileBySlug(slug: string): Promise<OrgProfileRecord | undefined> {
    const orgId = this.orgSlugIndex.get(slug);
    return orgId ? this.getOrgProfile(orgId) : undefined;
  }

  async upsertOrgProfile(profile: OrgProfileRecord): Promise<OrgProfileRecord> {
    const stored = this.saveOrgProfile(profile);
    return clone(stored);
  }

  async listGroups(orgId: string): Promise<ReadonlyArray<GroupRecord>> {
    const groupIds = this.groupsByOrg.get(orgId);
    if (!groupIds) {
      return [];
    }
    return Array.from(groupIds)
      .map((id) => this.groups.get(id))
      .filter((group): group is GroupRecord => Boolean(group))
      .map((group) => clone(group));
  }

  async upsertGroup(group: GroupRecord): Promise<GroupRecord> {
    const stored = this.saveGroup(group);
    return clone(stored);
  }

  async deleteGroup(groupId: string): Promise<void> {
    const existing = this.groups.get(groupId);
    if (!existing) {
      return;
    }
    this.groups.delete(groupId);
    this.unlinkGroupFromOrg(groupId, existing.orgId);
    this.removeGroupFromMemberships(groupId, existing.orgId);
  }

  async listMembershipsByUser(userId: string): Promise<ReadonlyArray<MembershipRecord>> {
    const membershipIds = this.membershipsByUser.get(userId);
    if (!membershipIds) {
      return [];
    }
    return Array.from(membershipIds)
      .map((id) => this.memberships.get(id))
      .filter((membership): membership is MembershipRecord => Boolean(membership))
      .map((membership) => clone(membership));
  }

  async listMembershipsByOrg(orgId: string): Promise<ReadonlyArray<MembershipRecord>> {
    const membershipIds = this.membershipsByOrg.get(orgId);
    if (!membershipIds) {
      return [];
    }
    return Array.from(membershipIds)
      .map((id) => this.memberships.get(id))
      .filter((membership): membership is MembershipRecord => Boolean(membership))
      .map((membership) => clone(membership));
  }

  async upsertMembership(membership: MembershipRecord): Promise<MembershipRecord> {
    const stored = this.saveMembership(membership);
    return clone(stored);
  }

  async removeMembership(membershipId: string): Promise<void> {
    const existing = this.memberships.get(membershipId);
    if (!existing) {
      return;
    }
    this.memberships.delete(membershipId);
    this.unlinkMembership(existing);
  }

  async computeEffectiveIdentity(request: EffectiveIdentityRequest): Promise<EffectiveIdentity> {
    const user = this.users.get(request.userId);
    if (!user) {
      throw new Error(`User profile ${request.userId} not found`);
    }

    const membership = this.resolveMembership(request);
    const orgId = request.orgId ?? membership?.orgId ?? user.primaryOrgId;
    const org = orgId ? this.orgs.get(orgId) : undefined;

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
      const membership = this.memberships.get(request.membershipId);
      if (!membership) {
        throw new Error(`Membership ${request.membershipId} not found`);
      }
      if (membership.userId !== request.userId) {
        throw new Error(`Membership ${request.membershipId} does not belong to user ${request.userId}`);
      }
      if (request.orgId && membership.orgId !== request.orgId) {
        throw new Error(
          `Membership ${request.membershipId} does not belong to org ${request.orgId}`,
        );
      }
      return membership;
    }

    const membershipIds = this.membershipsByUser.get(request.userId);
    if (!membershipIds || membershipIds.size === 0) {
      return undefined;
    }

    if (!request.orgId) {
      const firstId = membershipIds.values().next().value as string | undefined;
      return firstId ? this.memberships.get(firstId) : undefined;
    }

    for (const membershipId of membershipIds) {
      const membership = this.memberships.get(membershipId);
      if (membership && membership.orgId === request.orgId) {
        return membership;
      }
    }

    return undefined;
  }

  private collectGroupLabels(groupIds: ReadonlyArray<string>): ReadonlyArray<LabelSet> {
    return groupIds
      .map((id) => this.groups.get(id))
      .filter((group): group is GroupRecord => Boolean(group))
      .map((group) => group.labels);
  }

  private collectGroupIds(groupIds: ReadonlyArray<string>): ReadonlyArray<string> {
    const resolvedIds = groupIds
      .map((id) => (this.groups.has(id) ? id : undefined))
      .filter((id): id is string => Boolean(id));
    return dedupe(resolvedIds);
  }

  private linkGroupToOrg(groupId: string, orgId: string): void {
    let groupsForOrg = this.groupsByOrg.get(orgId);
    if (!groupsForOrg) {
      groupsForOrg = new Set<string>();
      this.groupsByOrg.set(orgId, groupsForOrg);
    }
    groupsForOrg.add(groupId);
  }

  private unlinkGroupFromOrg(groupId: string, orgId: string): void {
    const groupsForOrg = this.groupsByOrg.get(orgId);
    if (!groupsForOrg) {
      return;
    }
    groupsForOrg.delete(groupId);
    if (groupsForOrg.size === 0) {
      this.groupsByOrg.delete(orgId);
    }
  }

  private removeGroupFromMemberships(groupId: string, orgId: string): void {
    const membershipIds = this.membershipsByOrg.get(orgId);
    if (!membershipIds) {
      return;
    }
    for (const membershipId of membershipIds) {
      const membership = this.memberships.get(membershipId);
      if (!membership) {
        continue;
      }
      if (!membership.groupIds.includes(groupId)) {
        continue;
      }
      const updated: MembershipRecord = {
        ...membership,
        groupIds: membership.groupIds.filter((id: string) => id !== groupId),
      };
      this.memberships.set(membershipId, updated);
    }
  }

  private saveUserProfile(profile: UserProfileRecord): UserProfileRecord {
    const stored = clone(profile);
    this.users.set(profile.id, stored);
    return stored;
  }

  private saveOrgProfile(profile: OrgProfileRecord): OrgProfileRecord {
    const stored = clone(profile);
    const existing = this.orgs.get(profile.id);
    if (existing && existing.slug !== profile.slug) {
      this.orgSlugIndex.delete(existing.slug);
    }
    this.orgs.set(profile.id, stored);
    this.orgSlugIndex.set(profile.slug, profile.id);
    return stored;
  }

  private saveGroup(group: GroupRecord): GroupRecord {
    const stored = clone(group);
    const existing = this.groups.get(group.id);
    if (existing && existing.orgId !== group.orgId) {
      this.unlinkGroupFromOrg(existing.id, existing.orgId);
    }
    this.groups.set(group.id, stored);
    this.linkGroupToOrg(group.id, group.orgId);
    return stored;
  }

  private saveMembership(membership: MembershipRecord): MembershipRecord {
    const stored = clone(membership);
    const existing = this.memberships.get(membership.id);
    if (existing) {
      this.unlinkMembership(existing);
    }
    this.memberships.set(membership.id, stored);
    this.linkMembership(stored);
    return stored;
  }

  private linkMembership(membership: MembershipRecord): void {
    this.addToIndex(this.membershipsByUser, membership.userId, membership.id);
    this.addToIndex(this.membershipsByOrg, membership.orgId, membership.id);
  }

  private unlinkMembership(membership: MembershipRecord): void {
    this.removeFromIndex(this.membershipsByUser, membership.userId, membership.id);
    this.removeFromIndex(this.membershipsByOrg, membership.orgId, membership.id);
  }

  private addToIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    let bucket = index.get(key);
    if (!bucket) {
      bucket = new Set<string>();
      index.set(key, bucket);
    }
    bucket.add(value);
  }

  private removeFromIndex(index: Map<string, Set<string>>, key: string, value: string): void {
    const bucket = index.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(value);
    if (bucket.size === 0) {
      index.delete(key);
    }
  }
}

export const createInMemoryProfileStore = (
  options?: InMemoryProfileStoreOptions,
): ProfileStorePort => new InMemoryProfileStore(options);
