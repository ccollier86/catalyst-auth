import type {
  EntitlementQuery,
  EntitlementRecord,
  EntitlementStorePort,
  LabelSet,
} from "@catalyst-auth/contracts";

import type { PostgresTableNames } from "../tables.js";
import type { QueryExecutor } from "../executors/query-executor.js";
type EntitlementTables = Pick<PostgresTableNames, "entitlements">;

interface PostgresEntitlementStoreOptions {
  readonly tables?: EntitlementTables;
}

interface EntitlementRow {
  readonly id: string;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly entitlement: string;
  readonly created_at: string;
  readonly metadata: Record<string, unknown> | null;
}

const normalizeLabelSet = (input: Record<string, unknown> | null): LabelSet | undefined => {
  if (!input) {
    return undefined;
  }
  const entries = Object.entries(input).filter(([, value]) =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean",
  ) as Array<[string, LabelSet[keyof LabelSet]]>;

  const normalized: Record<string, LabelSet[keyof LabelSet]> = {};
  for (const [key, value] of entries) {
    normalized[key] = value;
  }

  return normalized as LabelSet;
};

const toRecord = (row: EntitlementRow): EntitlementRecord => ({
  id: row.id,
  subjectKind: row.subject_kind as EntitlementRecord["subjectKind"],
  subjectId: row.subject_id,
  entitlement: row.entitlement,
  createdAt: row.created_at,
  metadata: normalizeLabelSet(row.metadata),
});

const buildSubjectClauses = (
  subjects: ReadonlyArray<EntitlementQuery>,
): { text: string; values: ReadonlyArray<unknown> } => {
  if (subjects.length === 0) {
    return { text: "SELECT * FROM %TABLE% WHERE false", values: [] };
  }

  const clauses: string[] = [];
  const values: unknown[] = [];

  for (const [index, subject] of subjects.entries()) {
    const kindParam = `$${index * 2 + 1}`;
    const idParam = `$${index * 2 + 2}`;
    clauses.push(`(subject_kind = ${kindParam} AND subject_id = ${idParam})`);
    values.push(subject.subjectKind, subject.subjectId);
  }

  return {
    text: `SELECT * FROM %TABLE% WHERE ${clauses.join(" OR ")} ORDER BY created_at ASC, id ASC`,
    values,
  };
};

export class PostgresEntitlementStore implements EntitlementStorePort {
  private readonly tables: EntitlementTables;

  constructor(
    private readonly executor: QueryExecutor,
    options: PostgresEntitlementStoreOptions = {},
  ) {
    this.tables = {
      entitlements: options.tables?.entitlements ?? "auth_entitlements",
    };
  }

  async listEntitlements(subject: EntitlementQuery): Promise<ReadonlyArray<EntitlementRecord>> {
    const { rows } = await this.executor.query<EntitlementRow>(
      `SELECT * FROM ${this.tables.entitlements}
        WHERE subject_kind = $1 AND subject_id = $2
        ORDER BY created_at ASC, id ASC`,
      [subject.subjectKind, subject.subjectId],
    );

    return rows.map((row) => toRecord(row));
  }

  async listEntitlementsForSubjects(
    subjects: ReadonlyArray<EntitlementQuery>,
  ): Promise<ReadonlyArray<EntitlementRecord>> {
    if (subjects.length === 0) {
      return [];
    }

    const { text, values } = buildSubjectClauses(subjects);
    const query = text.replace("%TABLE%", this.tables.entitlements);
    const { rows } = await this.executor.query<EntitlementRow>(query, values);
    return rows.map((row) => toRecord(row));
  }

  async upsertEntitlement(entitlement: EntitlementRecord): Promise<EntitlementRecord> {
    const { rows } = await this.executor.query<EntitlementRow>(
      `INSERT INTO ${this.tables.entitlements} (
        id,
        subject_kind,
        subject_id,
        entitlement,
        created_at,
        metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6
      )
      ON CONFLICT (id) DO UPDATE SET
        subject_kind = EXCLUDED.subject_kind,
        subject_id = EXCLUDED.subject_id,
        entitlement = EXCLUDED.entitlement,
        created_at = EXCLUDED.created_at,
        metadata = EXCLUDED.metadata
      RETURNING *`,
      [
        entitlement.id,
        entitlement.subjectKind,
        entitlement.subjectId,
        entitlement.entitlement,
        entitlement.createdAt,
        entitlement.metadata ?? null,
      ],
    );

    return toRecord(rows[0]);
  }

  async removeEntitlement(id: string): Promise<void> {
    await this.executor.query(
      `DELETE FROM ${this.tables.entitlements} WHERE id = $1`,
      [id],
    );
  }
}

export const createPostgresEntitlementStore = (
  executor: QueryExecutor,
  options?: PostgresEntitlementStoreOptions,
): EntitlementStorePort => new PostgresEntitlementStore(executor, options);
