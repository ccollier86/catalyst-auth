import type { QueryExecutor, QueryResult } from "../executors/query-executor.js";
import type { PostgresTableNames } from "../postgres-data-source.js";
import {
  InMemoryPostgresDatabase,
  type AuditEventRow,
  type EntitlementRow,
  type GroupRow,
  type KeyRow,
  type MembershipRow,
  type OrgRow,
  type SessionRow,
  type UserRow,
} from "./in-memory-database.js";

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
