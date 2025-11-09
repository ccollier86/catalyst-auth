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

import { InMemoryPostgresDatabase } from "../testing/in-memory-database.js";
import { clone } from "../utils/clone.js";

interface Clock {
  now(): Date;
}

type IdFactory = () => string;

const defaultClock: Clock = {
  now: () => new Date(),
};

const defaultIdFactory: IdFactory = () => randomUUID();

const createError = (code: string, message: string, details?: Record<string, unknown>): CatalystError => ({
  code,
  message,
  details,
});

const ownerKey = (owner: KeyOwnerReference): string => `${owner.kind}:${owner.id}`;

const normalizeLabels = (labels: LabelSet | undefined): LabelSet => {
  if (!labels) {
    return {};
  }
  return { ...labels };
};

const cloneActor = (actor: KeyActorReference | undefined): KeyActorReference | undefined => {
  if (!actor) {
    return undefined;
  }
  return { ...actor };
};

const resolveStatus = (key: KeyRecord, now: Date): KeyStatus => {
  if (key.status === "revoked") {
    return "revoked";
  }
  if (key.status === "expired") {
    return "expired";
  }
  if (key.expiresAt) {
    const expiresAt = Date.parse(key.expiresAt);
    if (!Number.isNaN(expiresAt) && expiresAt <= now.getTime()) {
      return "expired";
    }
  }
  return "active";
};

const toRecord = (key: KeyRecord, now: Date): KeyRecord => ({
  id: key.id,
  hash: key.hash,
  name: key.name,
  description: key.description,
  owner: { ...key.owner },
  createdBy: cloneActor(key.createdBy),
  createdAt: key.createdAt,
  updatedAt: key.updatedAt,
  expiresAt: key.expiresAt,
  lastUsedAt: key.lastUsedAt,
  usageCount: key.usageCount,
  status: resolveStatus(key, now),
  scopes: [...key.scopes],
  labels: clone(key.labels),
  metadata: key.metadata ? clone(key.metadata) : undefined,
  revokedAt: key.revokedAt,
  revokedBy: cloneActor(key.revokedBy),
  revocationReason: key.revocationReason,
});

const structuredCloneKey = (key: KeyRecord): KeyRecord => ({
  id: key.id,
  hash: key.hash,
  name: key.name,
  description: key.description,
  owner: { ...key.owner },
  createdBy: cloneActor(key.createdBy),
  createdAt: key.createdAt,
  updatedAt: key.updatedAt,
  expiresAt: key.expiresAt,
  lastUsedAt: key.lastUsedAt,
  usageCount: key.usageCount,
  status: key.status,
  scopes: [...key.scopes],
  labels: clone(key.labels),
  metadata: key.metadata ? clone(key.metadata) : undefined,
  revokedAt: key.revokedAt,
  revokedBy: cloneActor(key.revokedBy),
  revocationReason: key.revocationReason,
});

const filterByStatus = (keys: ReadonlyArray<KeyRecord>, options?: ListKeysOptions): KeyRecord[] => {
  const now = new Date();
  return keys.filter((key) => {
    const status = resolveStatus(key, now);
    if (status === "revoked" && !options?.includeRevoked) {
      return false;
    }
    if (status === "expired" && !options?.includeExpired) {
      return false;
    }
    return true;
  });
};

const defaultDatabase = new InMemoryPostgresDatabase();

export class PostgresKeyStore implements KeyStorePort {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly database: InMemoryPostgresDatabase = defaultDatabase,
    options: { clock?: Clock; idFactory?: IdFactory } = {},
  ) {
    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  async issueKey(input: IssueKeyInput): Promise<Result<KeyRecord, CatalystError>> {
    const now = this.clock.now();
    const nowIso = now.toISOString();

    const id = input.id ?? this.idFactory();
    if (this.database.keys.has(id)) {
      return err(
        createError("key.postgres.duplicate_id", "A key with this id already exists.", {
          id,
        }),
      );
    }

    if (this.database.keyHashIndex.has(input.hash)) {
      return err(
        createError("key.postgres.duplicate_hash", "A key with this hash already exists.", {
          hash: input.hash,
        }),
      );
    }

    const record: KeyRecord = {
      id,
      hash: input.hash,
      owner: { ...input.owner },
      createdBy: cloneActor(input.createdBy),
      name: input.name,
      description: input.description,
      createdAt: input.createdAt ?? nowIso,
      updatedAt: nowIso,
      expiresAt: input.expiresAt,
      lastUsedAt: undefined,
      usageCount: 0,
      status: "active",
      scopes: [...input.scopes],
      labels: normalizeLabels(input.labels),
      metadata: input.metadata ? clone(input.metadata) : undefined,
      revokedAt: undefined,
      revokedBy: undefined,
      revocationReason: undefined,
    };

    this.database.saveKey(record);
    return ok(toRecord(record, now));
  }

  async getKeyById(id: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const key = this.database.keys.get(id);
    if (!key) {
      return ok(undefined);
    }
    return ok(toRecord(key, this.clock.now()));
  }

  async getKeyByHash(hash: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const keyId = this.database.keyHashIndex.get(hash);
    if (!keyId) {
      return ok(undefined);
    }
    return this.getKeyById(keyId);
  }

  async listKeysByOwner(
    owner: KeyOwnerReference,
    options?: ListKeysOptions,
  ): Promise<Result<ReadonlyArray<KeyRecord>, CatalystError>> {
    const ownerKeyValue = ownerKey(owner);
    const keyIds = this.database.keyOwnerIndex.get(ownerKeyValue);
    if (!keyIds) {
      return ok([]);
    }
    const keys = Array.from(keyIds)
      .map((id) => this.database.keys.get(id))
      .filter((key): key is KeyRecord => Boolean(key))
      .map((key) => toRecord(key, this.clock.now()));
    return ok(filterByStatus(keys, options));
  }

  async recordKeyUsage(
    id: string,
    options?: KeyUsageOptions,
  ): Promise<Result<KeyRecord, CatalystError>> {
    const key = this.database.keys.get(id);
    if (!key) {
      return err(
        createError("key.postgres.not_found", "Key not found", {
          id,
        }),
      );
    }

    const usedAt = options?.usedAt ?? this.clock.now().toISOString();
    const updated: KeyRecord = {
      ...structuredCloneKey(key),
      lastUsedAt: usedAt,
      usageCount: key.usageCount + 1,
      updatedAt: usedAt,
    };
    this.database.saveKey(updated);
    return ok(toRecord(updated, this.clock.now()));
  }

  async revokeKey(id: string, input: RevokeKeyInput): Promise<Result<KeyRecord, CatalystError>> {
    const key = this.database.keys.get(id);
    if (!key) {
      return err(
        createError("key.postgres.not_found", "Key not found", {
          id,
        }),
      );
    }

    const revokedAt = input.revokedAt ?? this.clock.now().toISOString();
    const revoked: KeyRecord = {
      ...structuredCloneKey(key),
      status: "revoked",
      revokedAt,
      revokedBy: cloneActor(input.revokedBy),
      revocationReason: input.reason,
      updatedAt: revokedAt,
    };

    this.database.saveKey(revoked);
    return ok(toRecord(revoked, this.clock.now()));
  }
}

export const createPostgresKeyStore = (
  database?: InMemoryPostgresDatabase,
  options?: { clock?: Clock; idFactory?: IdFactory },
): KeyStorePort => new PostgresKeyStore(database, options);
