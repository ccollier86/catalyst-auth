import type {
  SessionRecord,
  SessionStorePort,
  SessionTouchUpdate,
} from "@catalyst-auth/contracts";

import type { PostgresTableNames } from "../postgres-data-source.js";
import type { QueryExecutor } from "../executors/query-executor.js";
import { clone } from "../utils/clone.js";

type SessionTables = Pick<PostgresTableNames, "sessions">;

interface PostgresSessionStoreOptions {
  readonly tables?: SessionTables;
}

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly created_at: string;
  readonly last_seen_at: string;
  readonly factors_verified: ReadonlyArray<string> | null;
  readonly metadata: Record<string, unknown> | null;
}

const toRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  userId: row.user_id,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  factorsVerified: row.factors_verified ? [...row.factors_verified] : [],
  metadata: row.metadata ? clone(row.metadata) : undefined,
});

export class PostgresSessionStore implements SessionStorePort {
  private readonly tables: SessionTables;

  constructor(
    private readonly executor: QueryExecutor,
    options: PostgresSessionStoreOptions = {},
  ) {
    this.tables = {
      sessions: options.tables?.sessions ?? "auth_sessions",
    };
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const { rows } = await this.executor.query<SessionRow>(
      `SELECT * FROM ${this.tables.sessions} WHERE id = $1 LIMIT 1`,
      [id],
    );

    if (rows.length === 0) {
      return undefined;
    }

    return toRecord(rows[0]);
  }

  async listSessionsByUser(userId: string): Promise<ReadonlyArray<SessionRecord>> {
    const { rows } = await this.executor.query<SessionRow>(
      `SELECT * FROM ${this.tables.sessions}
        WHERE user_id = $1
        ORDER BY last_seen_at DESC, created_at DESC`,
      [userId],
    );

    return rows.map((row) => toRecord(row));
  }

  async createSession(session: SessionRecord): Promise<SessionRecord> {
    const { rows } = await this.executor.query<SessionRow>(
      `INSERT INTO ${this.tables.sessions} (
        id,
        user_id,
        created_at,
        last_seen_at,
        factors_verified,
        metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6
      )
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        created_at = EXCLUDED.created_at,
        last_seen_at = EXCLUDED.last_seen_at,
        factors_verified = EXCLUDED.factors_verified,
        metadata = EXCLUDED.metadata
      RETURNING *`,
      [
        session.id,
        session.userId,
        session.createdAt,
        session.lastSeenAt,
        session.factorsVerified ?? [],
        session.metadata ?? null,
      ],
    );

    return toRecord(rows[0]);
  }

  async touchSession(id: string, update: SessionTouchUpdate): Promise<SessionRecord> {
    const assignments = [`last_seen_at = $2`];
    const values: unknown[] = [id, update.lastSeenAt];
    let parameterIndex = 3;

    if (Object.prototype.hasOwnProperty.call(update, "factorsVerified")) {
      assignments.push(`factors_verified = $${parameterIndex}`);
      values.push(update.factorsVerified ?? []);
      parameterIndex += 1;
    }

    if (Object.prototype.hasOwnProperty.call(update, "metadata")) {
      assignments.push(`metadata = $${parameterIndex}`);
      values.push(update.metadata ?? null);
      parameterIndex += 1;
    }

    const { rows } = await this.executor.query<SessionRow>(
      `UPDATE ${this.tables.sessions}
        SET ${assignments.join(", ")}
        WHERE id = $1
        RETURNING *`,
      values,
    );

    if (rows.length === 0) {
      throw new Error(`Session ${id} not found`);
    }

    return toRecord(rows[0]);
  }

  async deleteSession(id: string): Promise<void> {
    await this.executor.query(
      `DELETE FROM ${this.tables.sessions} WHERE id = $1`,
      [id],
    );
  }
}

export const createPostgresSessionStore = (
  executor: QueryExecutor,
  options?: PostgresSessionStoreOptions,
): SessionStorePort => new PostgresSessionStore(executor, options);
