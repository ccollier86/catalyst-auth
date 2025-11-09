import { randomUUID } from "node:crypto";

import {
  err,
  ok,
  type CatalystError,
  type IssueKeyInput,
  type KeyActorReference,
  type KeyOwnerKind,
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

import { createError, createInfraError } from "./errors.js";
import type { Clock, PostgresKeyStoreOptions, Queryable } from "./types.js";
import { clone, dedupeScopes, normalizeLabels } from "./utils.js";

interface KeyRow {
  readonly id: string;
  readonly hash: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly ownerKind: KeyOwnerKind;
  readonly ownerId: string;
  readonly createdByKind: KeyOwnerKind | null;
  readonly createdById: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly usageCount: number;
  readonly status: KeyStatus;
  readonly scopes: ReadonlyArray<string> | null;
  readonly labels: LabelSet | null;
  readonly metadata: Record<string, unknown> | null;
  readonly revokedAt: string | null;
  readonly revokedByKind: KeyOwnerKind | null;
  readonly revokedById: string | null;
  readonly revocationReason: string | null;
}

interface DuplicateError extends Error {
  readonly code?: string;
  readonly constraint?: string;
  readonly detail?: string;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

const tableNamePattern = /^[a-zA-Z0-9_]+$/;

const defaultTableName = "catalyst_keys";

const selectColumns = `
  id,
  hash,
  name,
  description,
  owner_kind as "ownerKind",
  owner_id as "ownerId",
  created_by_kind as "createdByKind",
  created_by_id as "createdById",
  created_at as "createdAt",
  updated_at as "updatedAt",
  expires_at as "expiresAt",
  last_used_at as "lastUsedAt",
  usage_count as "usageCount",
  status,
  scopes,
  labels,
  metadata,
  revoked_at as "revokedAt",
  revoked_by_kind as "revokedByKind",
  revoked_by_id as "revokedById",
  revocation_reason as "revocationReason"
`;

const ownerKey = (owner: KeyOwnerReference): string => `${owner.kind}:${owner.id}`;

const resolveStatus = (row: KeyRow, now: Date): KeyStatus => {
  if (row.status === "revoked") {
    return "revoked";
  }
  if (row.status === "expired") {
    return "expired";
  }
  if (row.expiresAt) {
    const expiresAt = Date.parse(row.expiresAt);
    if (!Number.isNaN(expiresAt) && expiresAt <= now.getTime()) {
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
  owner: {
    kind: row.ownerKind,
    id: row.ownerId,
  },
  createdBy: toActor(row.createdByKind, row.createdById),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  expiresAt: row.expiresAt ?? undefined,
  lastUsedAt: row.lastUsedAt ?? undefined,
  usageCount: row.usageCount,
  status: resolveStatus(row, now),
  scopes: row.scopes ? [...row.scopes] : [],
  labels: row.labels ? clone(row.labels) : {},
  metadata: row.metadata ? clone(row.metadata) : undefined,
  revokedAt: row.revokedAt ?? undefined,
  revokedBy: toActor(row.revokedByKind, row.revokedById),
  revocationReason: row.revocationReason ?? undefined,
});

const toActor = (
  kind: KeyOwnerKind | null,
  id: string | null,
): KeyActorReference | undefined => {
  if (!kind || !id) {
    return undefined;
  }
  return { kind, id };
};

const isDuplicateError = (error: unknown): error is DuplicateError => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown };
  return candidate.code === "23505";
};

const validateTableName = (name: string): string => {
  if (!tableNamePattern.test(name)) {
    throw new Error(
      `Invalid Postgres table name '${name}'. Only alphanumeric characters and underscores are allowed.`,
    );
  }
  return name;
};

export class PostgresKeyStore implements KeyStorePort {
  private readonly queryable: Queryable;
  private readonly clock: Clock;
  private readonly idFactory: () => string;
  private readonly tableName: string;

  constructor(options: PostgresKeyStoreOptions) {
    this.queryable = options.queryable;
    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.tableName = validateTableName(options.tableName ?? defaultTableName);
  }

  async issueKey(input: IssueKeyInput): Promise<Result<KeyRecord, CatalystError>> {
    const id = input.id ?? this.idFactory();
    const now = this.clock.now();
    const nowIso = now.toISOString();

    const scopes = dedupeScopes(input.scopes);
    const labels = normalizeLabels(input.labels);

    const sql = `INSERT INTO ${this.tableName} (
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
        metadata
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        NULL,
        0,
        'active',
        $12,
        $13,
        $14
      )
      RETURNING${selectColumns};`;

    try {
      const result = await this.queryable.query<KeyRow>(sql, [
        id,
        input.hash,
        input.owner.kind,
        input.owner.id,
        input.name ?? null,
        input.description ?? null,
        input.createdBy?.kind ?? null,
        input.createdBy?.id ?? null,
        input.createdAt ?? nowIso,
        input.createdAt ?? nowIso,
        input.expiresAt ?? null,
        scopes,
        Object.keys(labels).length > 0 ? labels : null,
        input.metadata ? clone(input.metadata) : null,
      ]);

      const row = result.rows[0];
      if (!row) {
        return err(
          createInfraError(
            "key.postgres.insert_failed",
            "Postgres did not return the inserted key row.",
            new Error("missing row"),
            { id },
          ),
        );
      }
      return ok(toRecord(row, this.clock.now()));
    } catch (error) {
      if (isDuplicateError(error)) {
        return err(mapDuplicateError(error, input));
      }
      return err(
        createInfraError("key.postgres.issue_failed", "Failed to issue key in Postgres.", error, {
          id,
        }),
      );
    }
  }

  async getKeyById(id: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const sql = `SELECT${selectColumns} FROM ${this.tableName} WHERE id = $1 LIMIT 1;`;
    try {
      const result = await this.queryable.query<KeyRow>(sql, [id]);
      const row = result.rows[0];
      if (!row) {
        return ok(undefined);
      }
      return ok(toRecord(row, this.clock.now()));
    } catch (error) {
      return err(
        createInfraError("key.postgres.get_failed", "Failed to load key by id from Postgres.", error, {
          id,
        }),
      );
    }
  }

  async getKeyByHash(hash: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const sql = `SELECT${selectColumns} FROM ${this.tableName} WHERE hash = $1 LIMIT 1;`;
    try {
      const result = await this.queryable.query<KeyRow>(sql, [hash]);
      const row = result.rows[0];
      if (!row) {
        return ok(undefined);
      }
      return ok(toRecord(row, this.clock.now()));
    } catch (error) {
      return err(
        createInfraError("key.postgres.get_failed", "Failed to load key by hash from Postgres.", error, {
          hash,
        }),
      );
    }
  }

  async listKeysByOwner(
    owner: KeyOwnerReference,
    options: ListKeysOptions = {},
  ): Promise<Result<ReadonlyArray<KeyRecord>, CatalystError>> {
    const params: unknown[] = [owner.kind, owner.id];
    const where: string[] = ["owner_kind = $1", "owner_id = $2"];

    if (!options.includeRevoked) {
      where.push("status <> 'revoked'");
    }

    if (!options.includeExpired) {
      const nowIso = this.clock.now().toISOString();
      params.push(nowIso);
      where.push(`(expires_at IS NULL OR expires_at > $${params.length})`);
    }

    const sql = `SELECT${selectColumns} FROM ${this.tableName} WHERE ${where.join(
      " AND ",
    )} ORDER BY created_at DESC;`;

    try {
      const result = await this.queryable.query<KeyRow>(sql, params);
      const now = this.clock.now();
      return ok(result.rows.map((row) => toRecord(row, now)));
    } catch (error) {
      return err(
        createInfraError("key.postgres.list_failed", "Failed to list keys by owner.", error, {
          owner: ownerKey(owner),
        }),
      );
    }
  }

  async recordKeyUsage(
    id: string,
    options: KeyUsageOptions = {},
  ): Promise<Result<KeyRecord, CatalystError>> {
    const existing = await this.getKeyById(id);
    if (!existing.ok) {
      return existing;
    }
    if (!existing.value) {
      return err(
        createError("key.postgres.not_found", "Key not found.", {
          id,
        }),
      );
    }

    const record = existing.value;
    if (record.status === "revoked") {
      return err(
        createError("key.postgres.revoked", "Cannot record usage for a revoked key.", {
          id,
        }),
      );
    }

    if (record.status === "expired") {
      return err(
        createError("key.postgres.expired", "Cannot record usage for an expired key.", {
          id,
        }),
      );
    }

    const usedAt = options.usedAt ?? this.clock.now().toISOString();
    const sql = `UPDATE ${this.tableName}
      SET last_used_at = $2,
          usage_count = usage_count + 1,
          updated_at = $2
      WHERE id = $1
      RETURNING${selectColumns};`;

    try {
      const result = await this.queryable.query<KeyRow>(sql, [id, usedAt]);
      const row = result.rows[0];
      if (!row) {
        return err(
          createInfraError(
            "key.postgres.usage_update_failed",
            "Postgres did not return a row after updating usage.",
            new Error("missing row"),
            { id },
          ),
        );
      }
      return ok(toRecord(row, this.clock.now()));
    } catch (error) {
      return err(
        createInfraError("key.postgres.usage_failed", "Failed to record key usage in Postgres.", error, {
          id,
        }),
      );
    }
  }

  async revokeKey(
    id: string,
    input: RevokeKeyInput = {},
  ): Promise<Result<KeyRecord, CatalystError>> {
    const existing = await this.getKeyById(id);
    if (!existing.ok) {
      return existing;
    }
    if (!existing.value) {
      return err(
        createError("key.postgres.not_found", "Key not found.", {
          id,
        }),
      );
    }

    const record = existing.value;
    if (record.status === "revoked") {
      return err(
        createError("key.postgres.already_revoked", "Key has already been revoked.", {
          id,
        }),
      );
    }

    const revokedAt = input.revokedAt ?? this.clock.now().toISOString();
    const sql = `UPDATE ${this.tableName}
      SET status = 'revoked',
          revoked_at = $2,
          revoked_by_kind = $3,
          revoked_by_id = $4,
          revocation_reason = $5,
          updated_at = $2
      WHERE id = $1
      RETURNING${selectColumns};`;

    try {
      const result = await this.queryable.query<KeyRow>(sql, [
        id,
        revokedAt,
        input.revokedBy?.kind ?? null,
        input.revokedBy?.id ?? null,
        input.reason ?? null,
      ]);
      const row = result.rows[0];
      if (!row) {
        return err(
          createInfraError(
            "key.postgres.revoke_failed",
            "Postgres did not return a row after revocation.",
            new Error("missing row"),
            { id },
          ),
        );
      }
      return ok(toRecord(row, this.clock.now()));
    } catch (error) {
      return err(
        createInfraError("key.postgres.revoke_failed", "Failed to revoke key in Postgres.", error, {
          id,
        }),
      );
    }
  }
}

const mapDuplicateError = (error: DuplicateError, input: IssueKeyInput): CatalystError => {
  if (error.constraint && error.constraint.includes("hash")) {
    return createError("key.postgres.duplicate_hash", "A key with this hash already exists.", {
      hash: input.hash,
    });
  }
  if (error.constraint && error.constraint.includes("pkey")) {
    return createError("key.postgres.duplicate_id", "A key with this id already exists.", {
      id: input.id,
    });
  }
  if (error.detail?.includes("hash")) {
    return createError("key.postgres.duplicate_hash", "A key with this hash already exists.", {
      hash: input.hash,
    });
  }
  return createError("key.postgres.duplicate_id", "A key with this id already exists.", {
    id: input.id,
  });
};

export const createPostgresKeyStore = (
  options: PostgresKeyStoreOptions,
): PostgresKeyStore => new PostgresKeyStore(options);
