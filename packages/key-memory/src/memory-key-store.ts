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

interface Clock {
  now(): Date;
}

type IdFactory = () => string;

export interface MemoryKeyStoreOptions {
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly initialKeys?: ReadonlyArray<KeyRecord>;
}

interface StoredKey {
  id: string;
  hash: string;
  name?: string;
  description?: string;
  owner: KeyOwnerReference;
  createdBy?: KeyActorReference;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  status: KeyStatus;
  scopes: string[];
  labels: LabelSet;
  metadata?: Record<string, unknown>;
  revokedAt?: string;
  revokedBy?: KeyActorReference;
  revocationReason?: string;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

const defaultIdFactory: IdFactory = () => randomUUID();

const structuredCloneFn: (<T>(value: T) => T) | undefined =
  (globalThis as unknown as { structuredClone?: <T>(value: T) => T }).structuredClone;

const clone = <T>(value: T): T => {
  if (value === undefined) {
    return value;
  }

  if (structuredCloneFn) {
    return structuredCloneFn(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

const dedupe = (values: ReadonlyArray<string>): string[] => {
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

const resolveStatus = (key: StoredKey, now: Date): KeyStatus => {
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

const toRecord = (key: StoredKey, now: Date): KeyRecord => ({
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

const toStored = (key: KeyRecord): StoredKey => ({
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

export class MemoryKeyStore implements KeyStorePort {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;
  private readonly keys = new Map<string, StoredKey>();
  private readonly hashIndex = new Map<string, string>();
  private readonly ownerIndex = new Map<string, Set<string>>();

  constructor(options: MemoryKeyStoreOptions = {}) {
    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;

    for (const key of options.initialKeys ?? []) {
      this.insertInitialKey(key);
    }
  }

  async issueKey(input: IssueKeyInput): Promise<Result<KeyRecord, CatalystError>> {
    const now = this.clock.now();
    const nowIso = now.toISOString();

    const id = input.id ?? this.idFactory();
    if (this.keys.has(id)) {
      return err(
        createError("key.memory.duplicate_id", "A key with this id already exists.", {
          id,
        }),
      );
    }

    if (this.hashIndex.has(input.hash)) {
      return err(
        createError("key.memory.duplicate_hash", "A key with this hash already exists.", {
          hash: input.hash,
        }),
      );
    }

    const stored: StoredKey = {
      id,
      hash: input.hash,
      name: input.name,
      description: input.description,
      owner: { ...input.owner },
      createdBy: cloneActor(input.createdBy),
      createdAt: input.createdAt ?? nowIso,
      updatedAt: input.createdAt ?? nowIso,
      expiresAt: input.expiresAt,
      lastUsedAt: undefined,
      usageCount: 0,
      status: "active",
      scopes: dedupe(input.scopes),
      labels: normalizeLabels(input.labels),
      metadata: input.metadata ? clone(input.metadata) : undefined,
      revokedAt: undefined,
      revokedBy: undefined,
      revocationReason: undefined,
    };

    this.storeKey(stored);

    return ok(toRecord(stored, now));
  }

  async getKeyById(id: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const key = this.keys.get(id);
    if (!key) {
      return ok(undefined);
    }
    const now = this.clock.now();
    return ok(toRecord(key, now));
  }

  async getKeyByHash(hash: string): Promise<Result<KeyRecord | undefined, CatalystError>> {
    const id = this.hashIndex.get(hash);
    if (!id) {
      return ok(undefined);
    }
    return this.getKeyById(id);
  }

  async listKeysByOwner(
    owner: KeyOwnerReference,
    options: ListKeysOptions = {},
  ): Promise<Result<ReadonlyArray<KeyRecord>, CatalystError>> {
    const includeRevoked = options.includeRevoked ?? false;
    const includeExpired = options.includeExpired ?? false;
    const ownerSet = this.ownerIndex.get(ownerKey(owner));
    if (!ownerSet) {
      return ok([]);
    }

    const now = this.clock.now();
    const results: KeyRecord[] = [];

    for (const id of ownerSet) {
      const stored = this.keys.get(id);
      if (!stored) {
        continue;
      }
      const status = resolveStatus(stored, now);
      if (status === "revoked" && !includeRevoked) {
        continue;
      }
      if (status === "expired" && !includeExpired) {
        continue;
      }
      results.push(toRecord(stored, now));
    }

    return ok(results);
  }

  async recordKeyUsage(
    id: string,
    options: KeyUsageOptions = {},
  ): Promise<Result<KeyRecord, CatalystError>> {
    const stored = this.keys.get(id);
    if (!stored) {
      return err(
        createError("key.memory.not_found", "Key not found.", {
          id,
        }),
      );
    }

    const now = this.clock.now();
    const status = resolveStatus(stored, now);
    if (status === "revoked") {
      return err(
        createError("key.memory.revoked", "Cannot record usage for a revoked key.", {
          id,
        }),
      );
    }
    if (status === "expired") {
      return err(
        createError("key.memory.expired", "Cannot record usage for an expired key.", {
          id,
        }),
      );
    }

    const usedAt = options.usedAt ?? now.toISOString();
    stored.lastUsedAt = usedAt;
    stored.usageCount += 1;
    stored.updatedAt = usedAt;

    return ok(toRecord(stored, this.clock.now()));
  }

  async revokeKey(
    id: string,
    input: RevokeKeyInput = {},
  ): Promise<Result<KeyRecord, CatalystError>> {
    const stored = this.keys.get(id);
    if (!stored) {
      return err(
        createError("key.memory.not_found", "Key not found.", {
          id,
        }),
      );
    }

    if (stored.status === "revoked") {
      return err(
        createError("key.memory.already_revoked", "Key has already been revoked.", {
          id,
        }),
      );
    }

    const now = this.clock.now();
    stored.status = "revoked";
    stored.revokedAt = input.revokedAt ?? now.toISOString();
    stored.revokedBy = cloneActor(input.revokedBy);
    stored.revocationReason = input.reason;
    stored.updatedAt = stored.revokedAt;

    return ok(toRecord(stored, now));
  }

  private storeKey(key: StoredKey) {
    this.keys.set(key.id, key);
    this.hashIndex.set(key.hash, key.id);

    const keyForOwner = ownerKey(key.owner);
    const set = this.ownerIndex.get(keyForOwner) ?? new Set<string>();
    set.add(key.id);
    this.ownerIndex.set(keyForOwner, set);
  }

  private insertInitialKey(key: KeyRecord) {
    const stored = toStored(key);
    if (this.keys.has(stored.id)) {
      throw new Error(`Duplicate key id in initialKeys: ${stored.id}`);
    }
    if (this.hashIndex.has(stored.hash)) {
      throw new Error(`Duplicate key hash in initialKeys: ${stored.hash}`);
    }
    this.storeKey(stored);
  }
}

export const createMemoryKeyStore = (
  options: MemoryKeyStoreOptions = {},
): MemoryKeyStore => new MemoryKeyStore(options);
