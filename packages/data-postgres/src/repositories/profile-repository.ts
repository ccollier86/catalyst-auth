import type {
  EffectiveIdentity,
  EffectiveIdentityRequest,
  EntitlementSubjectKind,
  GroupRecord,
  LabelSet,
  MembershipRecord,
  OrgProfileRecord,
  ProfileStorePort,
  UserProfileRecord,
} from "@catalyst-auth/contracts";

import type { PostgresTableNames } from "../tables.js";
import type { QueryExecutor } from "../executors/query-executor.js";
import { clone } from "../utils/clone.js";

interface ProfileTables
  extends Pick<PostgresTableNames, "users" | "orgs" | "groups" | "memberships" | "entitlements"> {}

interface PostgresProfileStoreOptions {
  readonly tables?: ProfileTables;
}

interface EntitlementSubject {
  readonly subjectKind: EntitlementSubjectKind;
  readonly subjectId: string;
}

interface UserRow {
  readonly id: string;
  readonly authentik_id: string;
  readonly email: string;
  readonly primary_org_id: string | null;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
  readonly labels: LabelSet | null;
  readonly metadata: Record<string, unknown> | null;
}

interface OrgRow {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly owner_user_id: string;
  readonly profile: Record<string, unknown>;
  readonly labels: LabelSet | null;
  readonly settings: Record<string, unknown>;
}

interface GroupRow {
  readonly id: string;
  readonly org_id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly parent_group_id: string | null;
  readonly labels: LabelSet | null;
}

interface MembershipRow {
  readonly id: string;
  readonly user_id: string;
  readonly org_id: string;
  readonly role: string;
  readonly group_ids: ReadonlyArray<string>;
  readonly labels_delta: LabelSet | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface EntitlementRow {
  readonly entitlement: string;
}

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

const dedupeStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
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

const toUserRecord = (row: UserRow): UserProfileRecord => ({
  id: row.id,
  authentikId: row.authentik_id,
  email: row.email,
  primaryOrgId: row.primary_org_id ?? undefined,
  displayName: row.display_name ?? undefined,
  avatarUrl: row.avatar_url ?? undefined,
  labels: clone(row.labels ?? {}),
  metadata: row.metadata ? clone(row.metadata) : undefined,
});

const toOrgRecord = (row: OrgRow): OrgProfileRecord => ({
  id: row.id,
  slug: row.slug,
  status: row.status as OrgProfileRecord["status"],
  ownerUserId: row.owner_user_id,
  profile: clone(row.profile ?? {}) as OrgProfileRecord["profile"],
  labels: clone(row.labels ?? {}),
  settings: clone(row.settings ?? {}),
});

const toGroupRecord = (row: GroupRow): GroupRecord => ({
  id: row.id,
  orgId: row.org_id,
  slug: row.slug,
  name: row.name,
  description: row.description ?? undefined,
  parentGroupId: row.parent_group_id ?? undefined,
  labels: clone(row.labels ?? {}),
});

const toMembershipRecord = (row: MembershipRow): MembershipRecord => ({
  id: row.id,
  userId: row.user_id,
  orgId: row.org_id,
  role: row.role,
  groupIds: [...row.group_ids],
  labelsDelta: clone(row.labels_delta ?? {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class PostgresProfileStore implements ProfileStorePort {
  private readonly tables: ProfileTables;

  constructor(
    private readonly executor: QueryExecutor,
    options: PostgresProfileStoreOptions = {},
  ) {
    this.tables = {
      users: options.tables?.users ?? "auth_users",
      orgs: options.tables?.orgs ?? "auth_orgs",
      groups: options.tables?.groups ?? "auth_groups",
      memberships: options.tables?.memberships ?? "auth_memberships",
      entitlements: options.tables?.entitlements ?? "auth_entitlements",
    };
  }

  async getUserProfile(id: string): Promise<UserProfileRecord | undefined> {
    const { rows } = await this.executor.query<UserRow>(
      `SELECT * FROM ${this.tables.users} WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (rows.length === 0) {
      return undefined;
    }
    return toUserRecord(rows[0]);
  }

  async upsertUserProfile(profile: UserProfileRecord): Promise<UserProfileRecord> {
    const { rows } = await this.executor.query<UserRow>(
      `INSERT INTO ${this.tables.users} (
        id,
        authentik_id,
        email,
        primary_org_id,
        display_name,
        avatar_url,
        labels,
        metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8
      )
      ON CONFLICT (id) DO UPDATE SET
        authentik_id = EXCLUDED.authentik_id,
        email = EXCLUDED.email,
        primary_org_id = EXCLUDED.primary_org_id,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url,
        labels = EXCLUDED.labels,
        metadata = EXCLUDED.metadata
      RETURNING *`,
      [
        profile.id,
        profile.authentikId,
        profile.email,
        profile.primaryOrgId ?? null,
        profile.displayName ?? null,
        profile.avatarUrl ?? null,
        profile.labels ?? {},
        profile.metadata ?? null,
      ],
    );
    return toUserRecord(rows[0]);
  }

  async getOrgProfile(id: string): Promise<OrgProfileRecord | undefined> {
    const { rows } = await this.executor.query<OrgRow>(
      `SELECT * FROM ${this.tables.orgs} WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (rows.length === 0) {
      return undefined;
    }
    return toOrgRecord(rows[0]);
  }

  async getOrgProfileBySlug(slug: string): Promise<OrgProfileRecord | undefined> {
    const { rows } = await this.executor.query<OrgRow>(
      `SELECT * FROM ${this.tables.orgs} WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    if (rows.length === 0) {
      return undefined;
    }
    return toOrgRecord(rows[0]);
  }

  async upsertOrgProfile(profile: OrgProfileRecord): Promise<OrgProfileRecord> {
    const { rows } = await this.executor.query<OrgRow>(
      `INSERT INTO ${this.tables.orgs} (
        id,
        slug,
        status,
        owner_user_id,
        profile,
        labels,
        settings
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7
      )
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        status = EXCLUDED.status,
        owner_user_id = EXCLUDED.owner_user_id,
        profile = EXCLUDED.profile,
        labels = EXCLUDED.labels,
        settings = EXCLUDED.settings
      RETURNING *`,
      [
        profile.id,
        profile.slug,
        profile.status,
        profile.ownerUserId,
        profile.profile,
        profile.labels,
        profile.settings,
      ],
    );
    return toOrgRecord(rows[0]);
  }

  async listGroups(orgId: string): Promise<ReadonlyArray<GroupRecord>> {
    const { rows } = await this.executor.query<GroupRow>(
      `SELECT * FROM ${this.tables.groups} WHERE org_id = $1 ORDER BY slug ASC`,
      [orgId],
    );
    return rows.map((row) => toGroupRecord(row));
  }

  async upsertGroup(group: GroupRecord): Promise<GroupRecord> {
    const { rows } = await this.executor.query<GroupRow>(
      `INSERT INTO ${this.tables.groups} (
        id,
        org_id,
        slug,
        name,
        description,
        parent_group_id,
        labels
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7
      )
      ON CONFLICT (id) DO UPDATE SET
        org_id = EXCLUDED.org_id,
        slug = EXCLUDED.slug,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        parent_group_id = EXCLUDED.parent_group_id,
        labels = EXCLUDED.labels
      RETURNING *`,
      [
        group.id,
        group.orgId,
        group.slug,
        group.name,
        group.description ?? null,
        group.parentGroupId ?? null,
        group.labels ?? {},
      ],
    );
    return toGroupRecord(rows[0]);
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.executor.query(
      `DELETE FROM ${this.tables.groups} WHERE id = $1`,
      [groupId],
    );
  }

  async listMembershipsByUser(userId: string): Promise<ReadonlyArray<MembershipRecord>> {
    const { rows } = await this.executor.query<MembershipRow>(
      `SELECT * FROM ${this.tables.memberships} WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    );
    return rows.map((row) => toMembershipRecord(row));
  }

  async listMembershipsByOrg(orgId: string): Promise<ReadonlyArray<MembershipRecord>> {
    const { rows } = await this.executor.query<MembershipRow>(
      `SELECT * FROM ${this.tables.memberships} WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId],
    );
    return rows.map((row) => toMembershipRecord(row));
  }

  async upsertMembership(membership: MembershipRecord): Promise<MembershipRecord> {
    const { rows } = await this.executor.query<MembershipRow>(
      `INSERT INTO ${this.tables.memberships} (
        id,
        user_id,
        org_id,
        role,
        group_ids,
        labels_delta,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        org_id = EXCLUDED.org_id,
        role = EXCLUDED.role,
        group_ids = EXCLUDED.group_ids,
        labels_delta = EXCLUDED.labels_delta,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        membership.id,
        membership.userId,
        membership.orgId,
        membership.role,
        membership.groupIds,
        membership.labelsDelta ?? {},
        membership.createdAt,
        membership.updatedAt,
      ],
    );
    return toMembershipRecord(rows[0]);
  }

  async removeMembership(membershipId: string): Promise<void> {
    await this.executor.query(
      `DELETE FROM ${this.tables.memberships} WHERE id = $1`,
      [membershipId],
    );
  }

  async computeEffectiveIdentity(request: EffectiveIdentityRequest): Promise<EffectiveIdentity> {
    const user = await this.getUserProfile(request.userId);
    if (!user) {
      throw new Error(`User profile ${request.userId} not found`);
    }

    const membership = await this.resolveMembership(request);
    const orgId = request.orgId ?? membership?.orgId ?? user.primaryOrgId;
    const org = orgId ? await this.getOrgProfile(orgId) : undefined;

    if (request.orgId && !org) {
      throw new Error(`Org profile ${request.orgId} not found`);
    }

    const includeGroups = request.includeGroups !== false;
    const groups = includeGroups && membership?.groupIds?.length
      ? await this.fetchGroupsByIds(membership.groupIds)
      : [];

    const labels = mergeLabelSets(
      user.labels,
      org?.labels,
      membership?.labelsDelta,
      ...(includeGroups ? groups.map((group) => group.labels) : []),
    );

    const entitlements = await this.collectEntitlements({
      userId: user.id,
      orgId: org?.id,
      membershipId: membership?.id,
    });

    return {
      userId: user.id,
      orgId: org?.id,
      groups: includeGroups ? dedupeStrings(groups.map((group) => group.id)) : [],
      labels,
      roles: membership ? [membership.role] : [],
      entitlements,
      scopes: [],
    };
  }

  private async resolveMembership(
    request: EffectiveIdentityRequest,
  ): Promise<MembershipRecord | undefined> {
    if (request.membershipId) {
      const membership = await this.getMembershipById(request.membershipId);
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

    if (request.orgId) {
      return this.findMembershipForUserAndOrg(request.userId, request.orgId);
    }

    const memberships = await this.listMembershipsByUser(request.userId);
    return memberships[0];
  }

  private async getMembershipById(id: string): Promise<MembershipRecord | undefined> {
    const { rows } = await this.executor.query<MembershipRow>(
      `SELECT * FROM ${this.tables.memberships} WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (rows.length === 0) {
      return undefined;
    }
    return toMembershipRecord(rows[0]);
  }

  private async findMembershipForUserAndOrg(
    userId: string,
    orgId: string,
  ): Promise<MembershipRecord | undefined> {
    const { rows } = await this.executor.query<MembershipRow>(
      `SELECT * FROM ${this.tables.memberships}
        WHERE user_id = $1 AND org_id = $2
        ORDER BY created_at ASC
        LIMIT 1`,
      [userId, orgId],
    );
    if (rows.length === 0) {
      return undefined;
    }
    return toMembershipRecord(rows[0]);
  }

  private async fetchGroupsByIds(ids: ReadonlyArray<string>): Promise<ReadonlyArray<GroupRecord>> {
    if (ids.length === 0) {
      return [];
    }
    const { rows } = await this.executor.query<GroupRow>(
      `SELECT * FROM ${this.tables.groups} WHERE id = ANY($1::text[])`,
      [ids],
    );
    return rows.map((row) => toGroupRecord(row));
  }

  private async collectEntitlements(
    context: { userId: string; orgId?: string; membershipId?: string },
  ): Promise<ReadonlyArray<string>> {
    const subjects: EntitlementSubject[] = [
      { subjectKind: "user", subjectId: context.userId },
    ];

    if (context.orgId) {
      subjects.push({ subjectKind: "org", subjectId: context.orgId });
    }

    if (context.membershipId) {
      subjects.push({ subjectKind: "membership", subjectId: context.membershipId });
    }

    if (subjects.length === 0) {
      return [];
    }

    const clauses = subjects.map((_, index) => {
      const kindParam = `$${index * 2 + 1}`;
      const idParam = `$${index * 2 + 2}`;
      return `(subject_kind = ${kindParam} AND subject_id = ${idParam})`;
    });

    const values = subjects.flatMap((subject) => [subject.subjectKind, subject.subjectId]);
    const query = `SELECT entitlement FROM ${this.tables.entitlements}
      WHERE ${clauses.join(" OR ")}
      ORDER BY created_at ASC, entitlement ASC`;

    const { rows } = await this.executor.query<EntitlementRow>(query, values);
    return dedupeStrings(rows.map((row) => row.entitlement));
  }
}

export const createPostgresProfileStore = (
  executor: QueryExecutor,
  options?: PostgresProfileStoreOptions,
): ProfileStorePort => new PostgresProfileStore(executor, options);
