import {
  type CatalystError,
  type IssueKeyInput,
  type KeyOwnerReference,
  type KeyRecord,
  type KeyUsageOptions,
  type ListKeysOptions,
  type Result,
} from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createValidationError } from "../shared/errors.js";
import { labelSetSchema } from "../shared/schemas.js";
import { safeParse } from "../shared/validation.js";

const keyOwnerKinds = ["user", "org", "service", "system"] as const;

const keyOwnerSchema: z.ZodType<KeyOwnerReference> = z.object({
  kind: z.enum(keyOwnerKinds),
  id: z.string().min(1),
});

const issueKeySchema: z.ZodType<IssueKeyInput> = z.object({
  id: z.string().min(1).optional(),
  hash: z.string().min(1),
  owner: keyOwnerSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  createdBy: keyOwnerSchema.optional(),
  scopes: z.array(z.string().min(1)),
  labels: labelSetSchema.optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

type ListKeysInput = {
  readonly owner: KeyOwnerReference;
  readonly options?: ListKeysOptions | undefined;
};

const listKeysSchema: z.ZodType<ListKeysInput> = z.object({
  owner: keyOwnerSchema,
  options: z
    .object({
      includeRevoked: z.boolean().optional(),
      includeExpired: z.boolean().optional(),
    })
    .optional(),
});

type RecordUsageInput = {
  readonly keyId: string;
  readonly options?: KeyUsageOptions | undefined;
};

const recordUsageSchema: z.ZodType<RecordUsageInput> = z.object({
  keyId: z.string().min(1),
  options: z
    .object({
      usedAt: z.string().optional(),
    })
    .optional(),
});

type RevokeKeyInput = {
  readonly keyId: string;
  readonly input?: {
    readonly reason?: string | undefined;
    readonly revokedBy?: KeyOwnerReference | undefined;
    readonly revokedAt?: string | undefined;
  };
};

const revokeKeySchema: z.ZodType<RevokeKeyInput> = z.object({
  keyId: z.string().min(1),
  input: z
    .object({
      reason: z.string().optional(),
      revokedBy: keyOwnerSchema.optional(),
      revokedAt: z.string().optional(),
    })
    .optional(),
});

/**
 * Key management operations exposed by the Catalyst SDK.
 */
export interface KeysModule {
  readonly issueKey: (input: IssueKeyInput) => Promise<Result<KeyRecord, CatalystError>>;
  readonly listKeys: (
    input: { owner: KeyOwnerReference; options?: ListKeysOptions },
  ) => Promise<Result<ReadonlyArray<KeyRecord>, CatalystError>>;
  readonly recordUsage: (
    input: { keyId: string; options?: KeyUsageOptions },
  ) => Promise<Result<KeyRecord, CatalystError>>;
  readonly revokeKey: (
    input: { keyId: string; input?: { reason?: string; revokedBy?: string } },
  ) => Promise<Result<KeyRecord, CatalystError>>;
}

const createIssueKey = (deps: CatalystSdkDependencies): KeysModule["issueKey"] => async (input) => {
  const parsed = safeParse(issueKeySchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.keyStore.issueKey(parsed.value);
};

const createListKeys = (deps: CatalystSdkDependencies): KeysModule["listKeys"] => async (input) => {
  const parsed = safeParse(listKeysSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.keyStore.listKeysByOwner(parsed.value.owner, parsed.value.options);
};

const createRecordUsage = (deps: CatalystSdkDependencies): KeysModule["recordUsage"] => async (input) => {
  const parsed = safeParse(recordUsageSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.keyStore.recordKeyUsage(parsed.value.keyId, parsed.value.options);
};

const createRevokeKey = (deps: CatalystSdkDependencies): KeysModule["revokeKey"] => async (input) => {
  const parsed = safeParse(revokeKeySchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.keyStore.revokeKey(parsed.value.keyId, parsed.value.input ?? {});
};

/**
 * Creates the {@link KeysModule} bound to the provided dependencies.
 */
export const createKeysModule = (deps: CatalystSdkDependencies): KeysModule => ({
  issueKey: createIssueKey(deps),
  listKeys: createListKeys(deps),
  recordUsage: createRecordUsage(deps),
  revokeKey: createRevokeKey(deps),
});
