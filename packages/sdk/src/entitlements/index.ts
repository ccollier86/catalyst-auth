import { ok, type CatalystError, type EntitlementRecord, type Result } from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createValidationError } from "../shared/errors.js";
import { labelValueSchema } from "../shared/schemas.js";
import { safeParse } from "../shared/validation.js";

type EntitlementSubject = {
  readonly kind: "user" | "org" | "membership";
  readonly id: string;
};

const entitlementSubjectKinds = ["user", "org", "membership"] as const;

const subjectSchema: z.ZodType<EntitlementSubject> = z.object({
  kind: z.enum(entitlementSubjectKinds),
  id: z.string().min(1),
});

const entitlementRecordSchema: z.ZodType<EntitlementRecord> = z.object({
  id: z.string().min(1),
  subjectKind: z.enum(entitlementSubjectKinds),
  subjectId: z.string().min(1),
  entitlement: z.string().min(1),
  createdAt: z.string().min(1),
  metadata: z.record(labelValueSchema).optional(),
});

type ListEntitlementsInput = {
  readonly subject: EntitlementSubject;
};

const listEntitlementsSchema: z.ZodType<ListEntitlementsInput> = z.object({
  subject: subjectSchema,
});

type ListEntitlementsForSubjectsInput = {
  readonly subjects: ReadonlyArray<EntitlementSubject>;
};

const listEntitlementsForSubjectsSchema: z.ZodType<ListEntitlementsForSubjectsInput> = z.object({
  subjects: z.array(subjectSchema).min(1),
});

type UpsertEntitlementInput = {
  readonly entitlement: EntitlementRecord;
};

const upsertEntitlementSchema: z.ZodType<UpsertEntitlementInput> = z.object({
  entitlement: entitlementRecordSchema,
});

type RemoveEntitlementInput = {
  readonly id: string;
};

const removeEntitlementSchema: z.ZodType<RemoveEntitlementInput> = z.object({
  id: z.string().min(1),
});

export interface EntitlementsModule {
  readonly listEntitlements: (
    input: z.infer<typeof listEntitlementsSchema>,
  ) => Promise<Result<ReadonlyArray<EntitlementRecord>, CatalystError>>;
  readonly listEntitlementsForSubjects: (
    input: z.infer<typeof listEntitlementsForSubjectsSchema>,
  ) => Promise<Result<ReadonlyArray<EntitlementRecord>, CatalystError>>;
  readonly upsertEntitlement: (
    input: z.infer<typeof upsertEntitlementSchema>,
  ) => Promise<Result<EntitlementRecord, CatalystError>>;
  readonly removeEntitlement: (
    input: z.infer<typeof removeEntitlementSchema>,
  ) => Promise<Result<null, CatalystError>>;
}

const createListEntitlements = (
  deps: CatalystSdkDependencies,
): EntitlementsModule["listEntitlements"] => async (input) => {
  const parsed = safeParse(listEntitlementsSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const records = await deps.entitlementStore.listEntitlements({
    subjectKind: parsed.value.subject.kind,
    subjectId: parsed.value.subject.id,
  });
  return ok(records);
};

const createListEntitlementsForSubjects = (
  deps: CatalystSdkDependencies,
): EntitlementsModule["listEntitlementsForSubjects"] => async (input) => {
  const parsed = safeParse(listEntitlementsForSubjectsSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const subjects = parsed.value.subjects.map((subject) => ({
    subjectKind: subject.kind,
    subjectId: subject.id,
  }));
  const records = await deps.entitlementStore.listEntitlementsForSubjects(subjects);
  return ok(records);
};

const createUpsertEntitlement = (
  deps: CatalystSdkDependencies,
): EntitlementsModule["upsertEntitlement"] => async (input) => {
  const parsed = safeParse(upsertEntitlementSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const record = await deps.entitlementStore.upsertEntitlement(parsed.value.entitlement);
  return ok(record);
};

const createRemoveEntitlement = (
  deps: CatalystSdkDependencies,
): EntitlementsModule["removeEntitlement"] => async (input) => {
  const parsed = safeParse(removeEntitlementSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  await deps.entitlementStore.removeEntitlement(parsed.value.id);
  return ok(null);
};

export const createEntitlementsModule = (deps: CatalystSdkDependencies): EntitlementsModule => ({
  listEntitlements: createListEntitlements(deps),
  listEntitlementsForSubjects: createListEntitlementsForSubjects(deps),
  upsertEntitlement: createUpsertEntitlement(deps),
  removeEntitlement: createRemoveEntitlement(deps),
});
