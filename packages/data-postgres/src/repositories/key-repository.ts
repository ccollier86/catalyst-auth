import { randomUUID } from "node:crypto";

import {
  err,
  ok,
  type CatalystError,
  type IssueKeyInput,
  type KeyActorReference,
  type KeyOwnerReference,
  type KeyRecord,
  type KeyStatus,
  type KeyStorePort,
  type KeyUsageOptions,
  type LabelSet,
  type ListKeysOptions,
  type Result,
  type RevokeKeyInput,
} from "@catalyst-auth/contracts";

import type { PostgresTableNames } from "../postgres-data-source.js";
import type { QueryExecutor } from "../executors/query-executor.js";
import { clone } from "../utils/clone.js";

interface Clock {
  now(): Date;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

type IdFactory = () => string;

const defaultIdFactory: IdFactory = () => randomUUID();

const createError = (code: string, message: string, details?: Record<string, unknown>): CatalystError => ({
  code,
  message,
  details,
});

const normalizeLabels = (labels: LabelSet | undefined): LabelSet => ({ ...(labels ?? {}) });

const dedupeScopes = (scopes: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const scope of scopes) {
    if (seen.has(scope)) {
      continue;
    }
    seen.add(scope);
    result.push(scope);
  }
  return result;
};

const actorToColumns = (
  actor: KeyActorReference | undefined,
): [string | null, string | null] => (actor ? [actor.kind, actor.id] : [null, null]);

const actorFromColumns = (
  kind: string | null,
  id: string | null,
): KeyActorReference | undefined => {
  if (!kind || !id) {
    return undefined;
  }
  return { kind: kind as KeyOwnerReference["kind"], id };
};

const resolveStatus = (status: string, expiresAt: string | null, revokedAt: string | null, now: Date): KeyStatus => {
  if (status === "revoked" || revokedAt) {
    return "revoked";
  }
  if (status === "expired") {
    return "expired";
  }
  if (expiresAt) {
    const expires = Date.parse(expiresAt);
    if (!Number.isNaN(expires) && expires <= now.getTime()) {
      return "expired";
    }
  }
  return "active";
};

const toRecord = (row: KeyRow, now: Date): KeyRecord => ({
  id: row.id,
  hash: row.hash,
  name: row.name ?? undefined,
  description: row.description ?? undefined,
  owner: { kind: row.owner_kind as KeyOwnerReference["kind"], id: row.owner_id },
  createdBy: actorFromColumns(row.created_by_kind, row.created_by_id),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at ?? undefined,
  lastUsedAt: row.last_used_at ?? undefined,
  usageCount: Number(row.usage_count ?? 0),
  status: resolveStatus(row.status, row.expires_at, row.revoked_at, now),
  scopes: [...row.scopes],
  labels: clone(row.labels ?? {}),
  metadata: row.metadata ? clone(row.metadata) : undefined,
  revokedAt: row.revoked_at ?? undefined,
  revokedBy: actorFromColumns(row.revoked_by_kind, row.revoked_by_id),
  revocationReason: row.revocation_reason ?? undefined,
});

interface KeyRow {
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

interface UniqueViolationError extends Error {
  readonly code?: string;
  readonly detail?: string;
  readonly constraint?: string;
}

const isUniqueViolation = (error: unknown): error is UniqueViolationError =>
  Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505");

const resolveUniqueViolationTarget = (error: UniqueViolationError): "id" | "hash" | undefined => {
  if (typeof error.detail === "string") {
    if (error.detail.includes("(id)")) {
      return "id";
    }
    if (error.detail.includes("(hash)")) {
      return "hash";
    }
  }
  const constraint = error.constraint ?? "";
  if (constraint.includes("hash")) {
    return "hash";
  }
  if (constraint.includes("id") || constraint.includes("pkey")) {
    return "id";
  }
  return undefined;
};

interface PostgresKeyStoreOptions {
  readonly tables?: Pick<PostgresTableNames, "keys">;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
}

export class PostgresKeyStore implements KeyStorePort {
  private readonly table: string;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly executor: QueryExecutor,
    options: PostgresKeyStoreOptions = {},
  ) {
    this.table = options.tables?.keys ?? "auth_keys";
    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  async issueKey(input: IssueKeyInput): Promise<Result<KeyRecord, CatalystError>> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const id = input.id ?? this.idFactory();
    const [createdByKind, createdById] = actorToColumns(input.createdBy);

    try {
      const { rows } = await this.executor.query<KeyRow>(
        `INSERT INTO ${this.table} (
          id,
          hash,
          owner_kind,
          owner_id,
          name,
          description,
          created_by_kind,
          created_by_id,
          created_at,
          updated_at,
          expires_at,
          last_used_at,
          usage_count,
          status,
          scopes,
          labels,
          metadata,
          revoked_at,
          revoked_by_kind,
          revoked_by_id,
          revocation_reason
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
        )
        RETURNING *`,
        [
          id,
          input.hash,
          input.owner.kind,
          input.owner.id,
          input.name ?? null,
          input.description ?? null,
          createdByKind,
          createdById,
          input.createdAt ?? nowIso,
          nowIso,
          input.expiresAt ?? null,
          null,
          0,
          "active",
          dedupeScopes(input.scopes),
          normalizeLabels(input.labels),
          input.metadata ?? null,
          null,
          null,
          null,
          null,
        ],
      );

      return ok(toRecord(rows[0], now));
    } catch (error) {
      if (isUniqueViolation(error)) {
        const target = resolveUniqueViolationTarget(error);
        if (target === "id") {
          return err(
            createError("key.postgres.duplicate_id", "A key with this id already exists.", {
              id,
            }),
          );
        }
        if (target === "hash") {
          return err(
            createError("key.postgres.duplicate_hash", "A key with this hash already exists.", {
              hash: input.hash,
            }),
          );
        }
        return err(createError("key.postgres.duplicate", "A key with matching unique fields already exists."));
      }
      throw error;
    }
  }

  async getKeyById(id: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const { rows } = await this.executor.query<KeyRow>(
      `SELECT * FROM ${this.table} WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (rows.length === 0) {
      return ok(undefined);
    }
    return ok(toRecord(rows[0], this.clock.now()));
  }

  async getKeyByHash(hash: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const { rows } = await this.executor.query<KeyRow>(
      `SELECT * FROM ${this.table} WHERE hash = $1 LIMIT 1`,
      [hash],
    );
    if (rows.length === 0) {
      return ok(undefined);
    }
    return ok(toRecord(rows[0], this.clock.now()));
  }

  async listKeysByOwner(
    owner: KeyOwnerReference,
    options?: ListKeysOptions,
  ): Promise<Result<ReadonlyArray<KeyRecord>, CatalystError>> {
    const { rows } = await this.executor.query<KeyRow>(
      `SELECT * FROM ${this.table} WHERE owner_kind = $1 AND owner_id = $2 ORDER BY created_at DESC`,
      [owner.kind, owner.id],
    );
    const now = this.clock.now();
    const records = rows
      .map((row) => toRecord(row, now))
      .filter((record) => {
        if (record.status === "revoked" && !options?.includeRevoked) {
          return false;
        }
        if (record.status === "expired" && !options?.includeExpired) {
          return false;
        }
        return true;
      })
      .map((record) => ({ ...record, labels: clone(record.labels), scopes: [...record.scopes] }));
    return ok(records);
  }

  async recordKeyUsage(id: string, options?: KeyUsageOptions): Promise<Result<KeyRecord, CatalystError>> {
    const usedAt = options?.usedAt ?? this.clock.now().toISOString();
    const { rows } = await this.executor.query<KeyRow>(
      `UPDATE ${this.table}
        SET usage_count = usage_count + 1,
            last_used_at = $2,
            updated_at = $2
        WHERE id = $1
        RETURNING *`,
      [id, usedAt],
    );

    if (rows.length === 0) {
      return err(
        createError("key.postgres.not_found", "Key not found", {
          id,
        }),
      );
    }

    return ok(toRecord(rows[0], this.clock.now()));
  }

  async revokeKey(id: string, input: RevokeKeyInput): Promise<Result<KeyRecord, CatalystError>> {
    const revokedAt = input.revokedAt ?? this.clock.now().toISOString();
    const [revokedByKind, revokedById] = actorToColumns(input.revokedBy);

    const { rows } = await this.executor.query<KeyRow>(
      `UPDATE ${this.table}
        SET status = 'revoked',
            revoked_at = $2,
            revoked_by_kind = $3,
            revoked_by_id = $4,
            revocation_reason = $5,
            updated_at = $2
        WHERE id = $1
        RETURNING *`,
      [id, revokedAt, revokedByKind, revokedById, input.reason ?? null],
    );

    if (rows.length === 0) {
      return err(
        createError("key.postgres.not_found", "Key not found", {
          id,
        }),
      );
    }

    return ok(toRecord(rows[0], this.clock.now()));
  }
}

export const createPostgresKeyStore = (
  executor: QueryExecutor,
  options?: PostgresKeyStoreOptions,
): KeyStorePort => new PostgresKeyStore(executor, options);
