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
import { safeParse } from "../shared/validation.js";

const keyOwnerSchema = z.object({
  kind: z.enum(["user", "org", "service", "system"]),
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
  labels: z.record(z.union([z.string(), z.boolean(), z.number()])).optional(),
  expiresAt: z.string().optional(),
  createdAt: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const listKeysSchema = z.object({
  owner: keyOwnerSchema,
  options: z
    .object({
      includeRevoked: z.boolean().optional(),
      includeExpired: z.boolean().optional(),
    })
    .optional(),
});

const recordUsageSchema = z.object({
  keyId: z.string().min(1),
  options: z
    .object({
      usedAt: z.string().optional(),
    })
    .optional(),
});

const revokeKeySchema = z.object({
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
