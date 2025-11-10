import type { LabelSet } from "../../types/identity.js";

export type EntitlementSubjectKind = "user" | "org" | "membership";

export interface EntitlementRecord {
  readonly id: string;
  readonly subjectKind: EntitlementSubjectKind;
  readonly subjectId: string;
  readonly entitlement: string;
  readonly createdAt: string;
  readonly metadata?: LabelSet;
}

export interface EntitlementQuery {
  readonly subjectKind: EntitlementSubjectKind;
  readonly subjectId: string;
}

export interface EntitlementStorePort {
  listEntitlements(subject: EntitlementQuery): Promise<ReadonlyArray<EntitlementRecord>>;
  listEntitlementsForSubjects(
    subjects: ReadonlyArray<EntitlementQuery>,
  ): Promise<ReadonlyArray<EntitlementRecord>>;
  upsertEntitlement(entitlement: EntitlementRecord): Promise<EntitlementRecord>;
  removeEntitlement(id: string): Promise<void>;
}
