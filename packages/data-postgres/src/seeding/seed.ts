import type {
  AuditEventRecord,
  GroupRecord,
  KeyRecord,
  MembershipRecord,
  OrgProfileRecord,
  UserProfileRecord,
} from "@catalyst-auth/contracts";

import type { PostgresDataSource } from "../postgres-data-source.js";

export interface PostgresSeedData {
  readonly users?: ReadonlyArray<UserProfileRecord>;
  readonly orgs?: ReadonlyArray<OrgProfileRecord>;
  readonly groups?: ReadonlyArray<GroupRecord>;
  readonly memberships?: ReadonlyArray<MembershipRecord>;
  readonly keys?: ReadonlyArray<KeyRecord>;
  readonly auditEvents?: ReadonlyArray<AuditEventRecord>;
}

export const seedPostgresDataSource = async (
  dataSource: PostgresDataSource,
  seed: PostgresSeedData,
): Promise<void> => {
  for (const user of seed.users ?? []) {
    await dataSource.profileStore.upsertUserProfile(user);
  }
  for (const org of seed.orgs ?? []) {
    await dataSource.profileStore.upsertOrgProfile(org);
  }
  for (const group of seed.groups ?? []) {
    await dataSource.profileStore.upsertGroup(group);
  }
  for (const membership of seed.memberships ?? []) {
    await dataSource.profileStore.upsertMembership(membership);
  }
  for (const key of seed.keys ?? []) {
    dataSource.database.saveKey(key);
  }
  for (const event of seed.auditEvents ?? []) {
    dataSource.database.recordAuditEvent(event);
  }
};
