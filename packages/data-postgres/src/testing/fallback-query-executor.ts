import type {
  AuditEventRecord,
  LabelSet,
} from "@catalyst-auth/contracts";
import type { QueryExecutor, QueryResult } from "../executors/query-executor.js";
import type { PostgresTableNames } from "../tables.js";
import { clone } from "../utils/clone.js";

export interface UserRow {
  readonly id: string;
  readonly authentik_id: string;
  readonly email: string;
  readonly primary_org_id: string | null;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
  readonly labels: LabelSet | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface OrgRow {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly owner_user_id: string;
  readonly profile: Record<string, unknown>;
  readonly labels: LabelSet | null;
  readonly settings: Record<string, unknown>;
}

export interface GroupRow {
  readonly id: string;
  readonly org_id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly parent_group_id: string | null;
  readonly labels: LabelSet | null;
}

export interface MembershipRow {
  readonly id: string;
  readonly user_id: string;
  readonly org_id: string;
  readonly role: string;
  readonly group_ids: ReadonlyArray<string>;
  readonly labels_delta: LabelSet | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EntitlementRow {
  readonly id: string;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly entitlement: string;
  readonly created_at: string;
  readonly metadata: Record<string, unknown> | null;
}

export interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly created_at: string;
  readonly last_seen_at: string;
  readonly factors_verified: ReadonlyArray<string> | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface KeyRow {
  readonly id: string;
  readonly hash: string;
  readonly owner_kind: string;
  readonly owner_id: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly created_by_kind: string | null;
  readonly created_by_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly expires_at: string | null;
  readonly last_used_at: string | null;
  readonly usage_count: number;
  readonly status: string;
  readonly scopes: ReadonlyArray<string>;
  readonly labels: LabelSet | null;
  readonly metadata: Record<string, unknown> | null;
  readonly revoked_at: string | null;
  readonly revoked_by_kind: string | null;
  readonly revoked_by_id: string | null;
  readonly revocation_reason: string | null;
}

export interface AuditEventRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly category: string;
  readonly action: string;
  readonly actor: Record<string, unknown> | null;
  readonly subject: Record<string, unknown> | null;
  readonly resource: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
  readonly correlation_id: string | null;
}

const cloneRow = <Row>(row: Row): Row => clone(row);

const addToIndex = (index: Map<string, Set<string>>, key: string, value: string): void => {
  let bucket = index.get(key);
  if (!bucket) {
    bucket = new Set();
    index.set(key, bucket);
  }
  bucket.add(value);
};

const removeFromIndex = (index: Map<string, Set<string>>, key: string, value: string): void => {
  const bucket = index.get(key);
  if (!bucket) {
    return;
  }
  bucket.delete(value);
  if (bucket.size === 0) {
    index.delete(key);
  }
};

const subjectKey = (kind: string, id: string): string => `${kind}:${id}`;

const ownerKey = (kind: string, id: string): string => `${kind}:${id}`;

export class InMemoryPostgresDatabase {
  private readonly users = new Map<string, UserRow>();
  private readonly userAuthentikIndex = new Map<string, string>();

  private readonly orgs = new Map<string, OrgRow>();
  private readonly orgSlugIndex = new Map<string, string>();

  private readonly groups = new Map<string, GroupRow>();
  private readonly groupOrgIndex = new Map<string, Set<string>>();

  private readonly memberships = new Map<string, MembershipRow>();
  private readonly membershipUserIndex = new Map<string, Set<string>>();
  private readonly membershipOrgIndex = new Map<string, Set<string>>();

  private readonly entitlements = new Map<string, EntitlementRow>();
  private readonly entitlementSubjectIndex = new Map<string, Set<string>>();

  private readonly sessions = new Map<string, SessionRow>();
  private readonly sessionUserIndex = new Map<string, Set<string>>();

  private readonly keys = new Map<string, KeyRow>();
  private readonly keyHashIndex = new Map<string, string>();
  private readonly keyOwnerIndex = new Map<string, Set<string>>();

  private readonly auditEvents = new Map<string, AuditEventRow>();

  setUser(row: UserRow): UserRow {
    const copy = cloneRow(row);
    const existing = this.users.get(copy.id);
    if (existing && existing.authentik_id && existing.authentik_id !== copy.authentik_id) {
      this.userAuthentikIndex.delete(existing.authentik_id);
    }
    if (copy.authentik_id) {
      this.userAuthentikIndex.set(copy.authentik_id, copy.id);
    }
    this.users.set(copy.id, copy);
    return cloneRow(copy);
  }

  getUserById(id: string): UserRow | undefined {
    const row = this.users.get(id);
    return row ? cloneRow(row) : undefined;
  }

  getUserByAuthentikId(authentikId: string): UserRow | undefined {
    const userId = this.userAuthentikIndex.get(authentikId);
    if (!userId) {
      return undefined;
    }
    return this.getUserById(userId);
  }

  setOrg(row: OrgRow): OrgRow {
    const copy = cloneRow(row);
    const existing = this.orgs.get(copy.id);
    if (existing && existing.slug !== copy.slug) {
      this.orgSlugIndex.delete(existing.slug);
    }
    this.orgSlugIndex.set(copy.slug, copy.id);
    this.orgs.set(copy.id, copy);
    return cloneRow(copy);
  }

  getOrgById(id: string): OrgRow | undefined {
    const row = this.orgs.get(id);
    return row ? cloneRow(row) : undefined;
  }

  getOrgBySlug(slug: string): OrgRow | undefined {
    const orgId = this.orgSlugIndex.get(slug);
    if (!orgId) {
      return undefined;
    }
    return this.getOrgById(orgId);
  }

  setGroup(row: GroupRow): GroupRow {
    const copy = cloneRow(row);
    const existing = this.groups.get(copy.id);
    if (existing && existing.org_id !== copy.org_id) {
      removeFromIndex(this.groupOrgIndex, existing.org_id, existing.id);
    }
    this.groups.set(copy.id, copy);
    addToIndex(this.groupOrgIndex, copy.org_id, copy.id);
    return cloneRow(copy);
  }

  deleteGroup(id: string): void {
    const existing = this.groups.get(id);
    if (!existing) {
      return;
    }
    this.groups.delete(id);
    removeFromIndex(this.groupOrgIndex, existing.org_id, existing.id);
  }

  getGroupById(id: string): GroupRow | undefined {
    const row = this.groups.get(id);
    return row ? cloneRow(row) : undefined;
  }

  listGroupsByOrg(orgId: string): ReadonlyArray<GroupRow> {
    const ids = this.groupOrgIndex.get(orgId);
    if (!ids) {
      return [];
    }
    const rows: GroupRow[] = [];
    for (const id of ids) {
      const row = this.groups.get(id);
      if (row) {
        rows.push(cloneRow(row));
      }
    }
    return rows;
  }

  listGroupsByIds(ids: ReadonlyArray<string>): ReadonlyArray<GroupRow> {
    const rows: GroupRow[] = [];
    for (const id of ids) {
      const row = this.groups.get(id);
      if (row) {
        rows.push(cloneRow(row));
      }
    }
    return rows;
  }

  setMembership(row: MembershipRow): MembershipRow {
    const copy = cloneRow(row);
    const existing = this.memberships.get(copy.id);
    if (existing) {
      removeFromIndex(this.membershipUserIndex, existing.user_id, existing.id);
      removeFromIndex(this.membershipOrgIndex, existing.org_id, existing.id);
    }
    this.memberships.set(copy.id, copy);
    addToIndex(this.membershipUserIndex, copy.user_id, copy.id);
    addToIndex(this.membershipOrgIndex, copy.org_id, copy.id);
    return cloneRow(copy);
  }

  deleteMembership(id: string): void {
    const existing = this.memberships.get(id);
    if (!existing) {
      return;
    }
    this.memberships.delete(id);
    removeFromIndex(this.membershipUserIndex, existing.user_id, existing.id);
    removeFromIndex(this.membershipOrgIndex, existing.org_id, existing.id);
  }

  getMembershipById(id: string): MembershipRow | undefined {
    const row = this.memberships.get(id);
    return row ? cloneRow(row) : undefined;
  }

  listMembershipsByUser(userId: string): ReadonlyArray<MembershipRow> {
    const ids = this.membershipUserIndex.get(userId);
    if (!ids) {
      return [];
    }
    const rows: MembershipRow[] = [];
    for (const id of ids) {
      const row = this.memberships.get(id);
      if (row) {
        rows.push(cloneRow(row));
      }
    }
    return rows;
  }

  listMembershipsByOrg(orgId: string): ReadonlyArray<MembershipRow> {
    const ids = this.membershipOrgIndex.get(orgId);
    if (!ids) {
      return [];
    }
    const rows: MembershipRow[] = [];
    for (const id of ids) {
      const row = this.memberships.get(id);
      if (row) {
        rows.push(cloneRow(row));
      }
    }
    return rows;
  }

  findMembershipForUserAndOrg(userId: string, orgId: string): MembershipRow | undefined {
    const rows = this.listMembershipsByOrg(orgId).filter((row) => row.user_id === userId);
    rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
    return rows[0] ? cloneRow(rows[0]) : undefined;
  }

  setEntitlement(row: EntitlementRow): EntitlementRow {
    const copy = cloneRow(row);
    const existing = this.entitlements.get(copy.id);
    if (existing) {
      removeFromIndex(
        this.entitlementSubjectIndex,
        subjectKey(existing.subject_kind, existing.subject_id),
        existing.id,
      );
    }
    this.entitlements.set(copy.id, copy);
    addToIndex(
      this.entitlementSubjectIndex,
      subjectKey(copy.subject_kind, copy.subject_id),
      copy.id,
    );
    return cloneRow(copy);
  }

  deleteEntitlement(id: string): void {
    const existing = this.entitlements.get(id);
    if (!existing) {
      return;
    }
    this.entitlements.delete(id);
    removeFromIndex(
      this.entitlementSubjectIndex,
      subjectKey(existing.subject_kind, existing.subject_id),
      existing.id,
    );
  }

  listEntitlementsBySubject(kind: string, id: string): ReadonlyArray<EntitlementRow> {
    const ids = this.entitlementSubjectIndex.get(subjectKey(kind, id));
    if (!ids) {
      return [];
    }
    const rows: EntitlementRow[] = [];
    for (const entitlementId of ids) {
      const row = this.entitlements.get(entitlementId);
      if (row) {
        rows.push(cloneRow(row));
      }
    }
    rows.sort((left, right) => {
      const dateComparison = left.created_at.localeCompare(right.created_at);
      if (dateComparison !== 0) {
        return dateComparison;
      }
      return left.id.localeCompare(right.id);
    });
    return rows;
  }

  listEntitlementsBySubjects(subjects: ReadonlyArray<{ kind: string; id: string }>): ReadonlyArray<EntitlementRow> {
    const collected: EntitlementRow[] = [];
    for (const subject of subjects) {
      collected.push(...this.listEntitlementsBySubject(subject.kind, subject.id));
    }
    collected.sort((left, right) => {
      const dateComparison = left.created_at.localeCompare(right.created_at);
      if (dateComparison !== 0) {
        return dateComparison;
      }
      return left.id.localeCompare(right.id);
    });
    return collected;
  }

  setSession(row: SessionRow): SessionRow {
    const copy = cloneRow(row);
    const existing = this.sessions.get(copy.id);
    if (existing) {
      removeFromIndex(this.sessionUserIndex, existing.user_id, existing.id);
    }
    this.sessions.set(copy.id, copy);
    addToIndex(this.sessionUserIndex, copy.user_id, copy.id);
    return cloneRow(copy);
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.sessions.get(id);
    return row ? cloneRow(row) : undefined;
  }

  listSessionsByUser(userId: string): ReadonlyArray<SessionRow> {
    const ids = this.sessionUserIndex.get(userId);
    if (!ids) {
      return [];
    }
    const rows: SessionRow[] = [];
    for (const id of ids) {
      const row = this.sessions.get(id);
      if (row) {
        rows.push(cloneRow(row));
      }
    }
    rows.sort((left, right) => {
      const lastSeenComparison = right.last_seen_at.localeCompare(left.last_seen_at);
      if (lastSeenComparison !== 0) {
        return lastSeenComparison;
      }
      return right.created_at.localeCompare(left.created_at);
    });
    return rows;
  }

  deleteSession(id: string): void {
    const existing = this.sessions.get(id);
    if (!existing) {
      return;
    }
    this.sessions.delete(id);
    removeFromIndex(this.sessionUserIndex, existing.user_id, existing.id);
  }

  insertKey(row: KeyRow, { allowConflictUpdate = false }: { allowConflictUpdate?: boolean } = {}): KeyRow {
    const copy = cloneRow(row);
    const existing = this.keys.get(copy.id);
    const hashOwner = this.keyHashIndex.get(copy.hash);
    if (!allowConflictUpdate) {
      if (existing) {
        const error: Error & { code?: string; detail?: string; constraint?: string } = new Error(
          `duplicate key value violates unique constraint ${copy.id}`,
        );
        error.code = "23505";
        error.detail = `Key (id)=(${copy.id}) already exists.`;
        error.constraint = `${copy.id}_pkey`;
        throw error;
      }
      if (hashOwner && hashOwner !== copy.id) {
        const error: Error & { code?: string; detail?: string; constraint?: string } = new Error(
          `duplicate key value violates unique constraint ${copy.hash}`,
        );
        error.code = "23505";
        error.detail = `Key (hash)=(${copy.hash}) already exists.`;
        error.constraint = `${copy.hash}_key`;
        throw error;
      }
    }

    if (existing) {
      this.unregisterKey(existing);
    }

    if (hashOwner && hashOwner !== copy.id) {
      const error: Error & { code?: string; detail?: string; constraint?: string } = new Error(
        `duplicate key value violates unique constraint ${copy.hash}`,
      );
      error.code = "23505";
      error.detail = `Key (hash)=(${copy.hash}) already exists.`;
      error.constraint = `${copy.hash}_key`;
      throw error;
    }

    this.keys.set(copy.id, copy);
    this.registerKey(copy);
    return cloneRow(copy);
  }

  updateKey(id: string, update: (row: KeyRow) => KeyRow): KeyRow | undefined {
    const existing = this.keys.get(id);
    if (!existing) {
      return undefined;
    }
    this.unregisterKey(existing);
    const updated = cloneRow(update(existing));
    const hashOwner = this.keyHashIndex.get(updated.hash);
    if (hashOwner && hashOwner !== updated.id) {
      // restore previous state before throwing
      this.registerKey(existing);
      this.keys.set(existing.id, existing);
      const error: Error & { code?: string; detail?: string; constraint?: string } = new Error(
        `duplicate key value violates unique constraint ${updated.hash}`,
      );
      error.code = "23505";
      error.detail = `Key (hash)=(${updated.hash}) already exists.`;
      error.constraint = `${updated.hash}_key`;
      throw error;
    }
    this.keys.set(updated.id, updated);
    this.registerKey(updated);
    return cloneRow(updated);
  }

  getKeyById(id: string): KeyRow | undefined {
    const row = this.keys.get(id);
    return row ? cloneRow(row) : undefined;
  }

  getKeyByHash(hash: string): KeyRow | undefined {
    const id = this.keyHashIndex.get(hash);
    if (!id) {
      return undefined;
    }
    return this.getKeyById(id);
  }

  listKeysByOwner(kind: string, ownerId: string): ReadonlyArray<KeyRow> {
    const bucket = this.keyOwnerIndex.get(ownerKey(kind, ownerId));
    if (!bucket) {
      return [];
    }
    const rows: KeyRow[] = [];
    for (const id of bucket) {
      const row = this.keys.get(id);
      if (row) {
        rows.push(cloneRow(row));
      }
    }
    rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
    return rows;
  }

  private unregisterKey(row: KeyRow): void {
    this.keyHashIndex.delete(row.hash);
    const bucket = this.keyOwnerIndex.get(ownerKey(row.owner_kind, row.owner_id));
    if (bucket) {
      bucket.delete(row.id);
      if (bucket.size === 0) {
        this.keyOwnerIndex.delete(ownerKey(row.owner_kind, row.owner_id));
      }
    }
  }

  private registerKey(row: KeyRow): void {
    this.keyHashIndex.set(row.hash, row.id);
    addToIndex(this.keyOwnerIndex, ownerKey(row.owner_kind, row.owner_id), row.id);
  }

  deleteKey(id: string): void {
    const existing = this.keys.get(id);
    if (!existing) {
      return;
    }
    this.keys.delete(id);
    this.unregisterKey(existing);
  }

  insertAuditEvent(row: AuditEventRow): AuditEventRow {
    const copy = cloneRow(row);
    this.auditEvents.set(copy.id, copy);
    return cloneRow(copy);
  }

  listAuditEvents(): ReadonlyArray<AuditEventRow> {
    const rows = Array.from(this.auditEvents.values()).map((row) => cloneRow(row));
    rows.sort((left, right) => {
      const dateComparison = left.occurred_at.localeCompare(right.occurred_at);
      if (dateComparison !== 0) {
        return dateComparison;
      }
      return left.id.localeCompare(right.id);
    });
    return rows;
  }

  snapshotAuditEvents(): ReadonlyArray<AuditEventRecord> {
    return this.listAuditEvents().map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      category: row.category,
      action: row.action,
      actor: row.actor
        ? (clone(row.actor) as unknown as AuditEventRecord["actor"])
        : undefined,
      subject: row.subject
        ? (clone(row.subject) as unknown as AuditEventRecord["subject"])
        : undefined,
      resource: row.resource
        ? (clone(row.resource) as unknown as AuditEventRecord["resource"])
        : undefined,
      metadata: row.metadata ? clone(row.metadata) : undefined,
      correlationId: row.correlation_id ?? undefined,
    }));
  }
}
const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").trim();

const bool = (value: unknown): value is true => value === true;

export class InMemoryQueryExecutor implements QueryExecutor {
  constructor(
    private readonly database: InMemoryPostgresDatabase,
    private readonly tables: PostgresTableNames,
  ) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<Row>> {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith(`INSERT INTO ${this.tables.users} (`)) {
      const row: UserRow = {
        id: params[0] as string,
        authentik_id: params[1] as string,
        email: params[2] as string,
        primary_org_id: (params[3] ?? null) as string | null,
        display_name: (params[4] ?? null) as string | null,
        avatar_url: (params[5] ?? null) as string | null,
        labels: (params[6] ?? null) as UserRow["labels"],
        metadata: (params[7] ?? null) as UserRow["metadata"],
      };
      return { rows: [this.database.setUser(row) as Row] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.users} WHERE id = $1`)) {
      const row = this.database.getUserById(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.users} WHERE authentik_id = $1`)) {
      const row = this.database.getUserByAuthentikId(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.orgs} (`)) {
      const row: OrgRow = {
        id: params[0] as string,
        slug: params[1] as string,
        status: params[2] as string,
        owner_user_id: params[3] as string,
        profile: (params[4] ?? {}) as OrgRow["profile"],
        labels: (params[5] ?? null) as OrgRow["labels"],
        settings: (params[6] ?? {}) as OrgRow["settings"],
      };
      return { rows: [this.database.setOrg(row) as Row] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.orgs} WHERE id = $1`)) {
      const row = this.database.getOrgById(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.orgs} WHERE slug = $1`)) {
      const row = this.database.getOrgBySlug(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.groups} (`)) {
      const row: GroupRow = {
        id: params[0] as string,
        org_id: params[1] as string,
        slug: params[2] as string,
        name: params[3] as string,
        description: (params[4] ?? null) as string | null,
        parent_group_id: (params[5] ?? null) as string | null,
        labels: (params[6] ?? null) as GroupRow["labels"],
      };
      return { rows: [this.database.setGroup(row) as Row] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.groups} WHERE id = $1`)) {
      const row = this.database.getGroupById(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.groups} WHERE org_id = $1`)) {
      const rows = this.database.listGroupsByOrg(params[0] as string);
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.groups} WHERE id = ANY($1::text[])`)) {
      const ids = (params[0] as ReadonlyArray<string>) ?? [];
      const rows = this.database.listGroupsByIds(ids);
      return { rows: rows as unknown as Row[] };
    }

    if (normalized === `DELETE FROM ${this.tables.groups} WHERE id = $1`) {
      this.database.deleteGroup(params[0] as string);
      return { rows: [] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.memberships} (`)) {
      const row: MembershipRow = {
        id: params[0] as string,
        user_id: params[1] as string,
        org_id: params[2] as string,
        role: params[3] as string,
        group_ids: ((params[4] as ReadonlyArray<string>) ?? []).slice(),
        labels_delta: (params[5] ?? null) as MembershipRow["labels_delta"],
        created_at: params[6] as string,
        updated_at: params[7] as string,
      };
      return { rows: [this.database.setMembership(row) as Row] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.memberships} WHERE id = $1`)) {
      const row = this.database.getMembershipById(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.memberships} WHERE user_id = $1 ORDER BY created_at ASC`)) {
      const rows = this.database.listMembershipsByUser(params[0] as string).slice();
      rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.memberships} WHERE org_id = $1 ORDER BY created_at ASC`)) {
      const rows = this.database.listMembershipsByOrg(params[0] as string).slice();
      rows.sort((left, right) => left.created_at.localeCompare(right.created_at));
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.memberships} WHERE user_id = $1 AND org_id = $2`)) {
      const row = this.database.findMembershipForUserAndOrg(params[0] as string, params[1] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized === `DELETE FROM ${this.tables.memberships} WHERE id = $1`) {
      this.database.deleteMembership(params[0] as string);
      return { rows: [] };
    }

    if (normalized.startsWith(`SELECT entitlement FROM ${this.tables.entitlements} WHERE (`)) {
      const subjects = this.extractSubjects(params);
      const rows = this.database
        .listEntitlementsBySubjects(subjects)
        .map((row) => ({ entitlement: row.entitlement }));
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.entitlements} WHERE subject_kind = $1`)) {
      const rows = this.database.listEntitlementsBySubject(params[0] as string, params[1] as string);
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.entitlements} WHERE (`)) {
      const subjects = this.extractSubjects(params);
      const rows = this.database.listEntitlementsBySubjects(subjects);
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.entitlements} (`)) {
      const row: EntitlementRow = {
        id: params[0] as string,
        subject_kind: params[1] as string,
        subject_id: params[2] as string,
        entitlement: params[3] as string,
        created_at: params[4] as string,
        metadata: (params[5] ?? null) as EntitlementRow["metadata"],
      };
      return { rows: [this.database.setEntitlement(row) as Row] };
    }

    if (normalized === `DELETE FROM ${this.tables.entitlements} WHERE id = $1`) {
      this.database.deleteEntitlement(params[0] as string);
      return { rows: [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.sessions} WHERE id = $1`)) {
      const row = this.database.getSession(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.sessions} WHERE user_id = $1`)) {
      const rows = this.database.listSessionsByUser(params[0] as string);
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.sessions} (`)) {
      const row: SessionRow = {
        id: params[0] as string,
        user_id: params[1] as string,
        created_at: params[2] as string,
        last_seen_at: params[3] as string,
        factors_verified: ((params[4] as ReadonlyArray<string>) ?? []).slice(),
        metadata: (params[5] ?? null) as SessionRow["metadata"],
      };
      return { rows: [this.database.setSession(row) as Row] };
    }

    if (normalized.startsWith(`UPDATE ${this.tables.sessions} SET`)) {
      const id = params[0] as string;
      const lastSeenAt = params[1] as string;
      const existing = this.database.getSession(id);
      if (!existing) {
        throw new Error(`Session ${id} not found`);
      }
      let nextIndex = 2;
      let factors = existing.factors_verified;
      let metadata = existing.metadata;
      if (normalized.includes("factors_verified")) {
        factors = ((params[nextIndex] as ReadonlyArray<string>) ?? []).slice();
        nextIndex += 1;
      }
      if (normalized.includes("metadata =")) {
        metadata = (params[nextIndex] ?? null) as SessionRow["metadata"];
      }

      const stored = this.database.setSession({
        ...existing,
        last_seen_at: lastSeenAt,
        factors_verified: factors,
        metadata,
      });
      return { rows: [stored as Row] };
    }

    if (normalized === `DELETE FROM ${this.tables.sessions} WHERE id = $1`) {
      this.database.deleteSession(params[0] as string);
      return { rows: [] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.keys} (`) && normalized.includes("ON CONFLICT")) {
      const row = this.buildKeyRow(params);
      return { rows: [this.database.insertKey(row, { allowConflictUpdate: true }) as Row] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.keys} (`)) {
      const row = this.buildKeyRow(params);
      return { rows: [this.database.insertKey(row) as Row] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.keys} WHERE id = $1`)) {
      const row = this.database.getKeyById(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.keys} WHERE hash = $1`)) {
      const row = this.database.getKeyByHash(params[0] as string);
      return { rows: row ? ([row] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.keys} WHERE owner_kind = $1`)) {
      const rows = this.database.listKeysByOwner(params[0] as string, params[1] as string);
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith(`UPDATE ${this.tables.keys} SET usage_count = usage_count + 1`)) {
      const id = params[0] as string;
      const usedAt = params[1] as string;
      const updated = this.database.updateKey(id, (row) => ({
        ...row,
        usage_count: row.usage_count + 1,
        last_used_at: usedAt,
        updated_at: usedAt,
      }));
      return { rows: updated ? ([updated] as unknown as Row[]) : [] };
    }

    if (normalized.startsWith(`UPDATE ${this.tables.keys} SET status = 'revoked'`)) {
      const id = params[0] as string;
      const revokedAt = params[1] as string;
      const revokedByKind = params[2] as string | null;
      const revokedById = params[3] as string | null;
      const reason = params[4] as string | null;
      const updated = this.database.updateKey(id, (row) => ({
        ...row,
        status: "revoked",
        revoked_at: revokedAt,
        revoked_by_kind: revokedByKind,
        revoked_by_id: revokedById,
        revocation_reason: reason,
        updated_at: revokedAt,
      }));
      return { rows: updated ? ([updated] as unknown as Row[]) : [] };
    }

    if (normalized === `DELETE FROM ${this.tables.keys} WHERE id = $1`) {
      this.database.deleteKey(params[0] as string);
      return { rows: [] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.auditEvents} (`) && normalized.includes("ON CONFLICT")) {
      const row = this.buildAuditRow(params);
      return { rows: [this.database.insertAuditEvent(row) as Row] };
    }

    if (normalized.startsWith(`INSERT INTO ${this.tables.auditEvents} (`)) {
      const row = this.buildAuditRow(params);
      return { rows: [this.database.insertAuditEvent(row) as Row] };
    }

    if (normalized.startsWith(`SELECT * FROM ${this.tables.auditEvents} ORDER BY`)) {
      const rows = this.database.listAuditEvents();
      return { rows: rows as unknown as Row[] };
    }

    if (normalized.startsWith("SELECT true") && normalized.includes(this.tables.entitlements)) {
      return { rows: [{ exists: bool(params[0]) } as Row] };
    }

    throw new Error(`Unsupported test query: ${normalized}`);
  }

  private extractSubjects(params: ReadonlyArray<unknown>): ReadonlyArray<{ kind: string; id: string }> {
    const subjects: Array<{ kind: string; id: string }> = [];
    for (let index = 0; index < params.length; index += 2) {
      const kind = params[index];
      const id = params[index + 1];
      if (typeof kind === "string" && typeof id === "string") {
        subjects.push({ kind, id });
      }
    }
    return subjects;
  }

  private buildKeyRow(params: ReadonlyArray<unknown>): KeyRow {
    return {
      id: params[0] as string,
      hash: params[1] as string,
      owner_kind: params[2] as string,
      owner_id: params[3] as string,
      name: (params[4] ?? null) as string | null,
      description: (params[5] ?? null) as string | null,
      created_by_kind: (params[6] ?? null) as string | null,
      created_by_id: (params[7] ?? null) as string | null,
      created_at: params[8] as string,
      updated_at: params[9] as string,
      expires_at: (params[10] ?? null) as string | null,
      last_used_at: (params[11] ?? null) as string | null,
      usage_count: Number(params[12] ?? 0),
      status: params[13] as string,
      scopes: ((params[14] as ReadonlyArray<string>) ?? []).slice(),
      labels: (params[15] ?? null) as KeyRow["labels"],
      metadata: (params[16] ?? null) as KeyRow["metadata"],
      revoked_at: (params[17] ?? null) as string | null,
      revoked_by_kind: (params[18] ?? null) as string | null,
      revoked_by_id: (params[19] ?? null) as string | null,
      revocation_reason: (params[20] ?? null) as string | null,
    };
  }

  private buildAuditRow(params: ReadonlyArray<unknown>): AuditEventRow {
    return {
      id: params[0] as string,
      occurred_at: params[1] as string,
      category: params[2] as string,
      action: params[3] as string,
      actor: (params[4] ?? null) as AuditEventRow["actor"],
      subject: (params[5] ?? null) as AuditEventRow["subject"],
      resource: (params[6] ?? null) as AuditEventRow["resource"],
      metadata: (params[7] ?? null) as AuditEventRow["metadata"],
      correlation_id: (params[8] ?? null) as string | null,
    };
  }
}

export interface FallbackHarness {
  readonly executor: QueryExecutor;
  readonly listAuditEvents: () => ReadonlyArray<AuditEventRecord>;
}

export const createFallbackHarness = (tables: PostgresTableNames): FallbackHarness => {
  const database = new InMemoryPostgresDatabase();
  const executor = new InMemoryQueryExecutor(database, tables);

  return {
    executor,
    listAuditEvents: () => database.snapshotAuditEvents(),
  };
};
