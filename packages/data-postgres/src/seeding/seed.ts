import type {
  AuditEventRecord,
  EntitlementRecord,
  GroupRecord,
  KeyRecord,
  MembershipRecord,
  OrgProfileRecord,
  SessionRecord,
  UserProfileRecord,
} from "@catalyst-auth/contracts";

import type { PostgresDataSource } from "../postgres-data-source.js";

export interface PostgresSeedData {
  readonly users?: ReadonlyArray<UserProfileRecord>;
  readonly orgs?: ReadonlyArray<OrgProfileRecord>;
  readonly groups?: ReadonlyArray<GroupRecord>;
  readonly memberships?: ReadonlyArray<MembershipRecord>;
  readonly entitlements?: ReadonlyArray<EntitlementRecord>;
  readonly sessions?: ReadonlyArray<SessionRecord>;
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

  for (const entitlement of seed.entitlements ?? []) {
    await dataSource.entitlementStore.upsertEntitlement(entitlement);
  }

  for (const session of seed.sessions ?? []) {
    await dataSource.sessionStore.createSession(session);
  }

  for (const key of seed.keys ?? []) {
    await dataSource.executor.query(
      `INSERT INTO ${dataSource.tables.keys} (
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
      ON CONFLICT (id) DO UPDATE SET
        hash = EXCLUDED.hash,
        owner_kind = EXCLUDED.owner_kind,
        owner_id = EXCLUDED.owner_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        created_by_kind = EXCLUDED.created_by_kind,
        created_by_id = EXCLUDED.created_by_id,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        expires_at = EXCLUDED.expires_at,
        last_used_at = EXCLUDED.last_used_at,
        usage_count = EXCLUDED.usage_count,
        status = EXCLUDED.status,
        scopes = EXCLUDED.scopes,
        labels = EXCLUDED.labels,
        metadata = EXCLUDED.metadata,
        revoked_at = EXCLUDED.revoked_at,
        revoked_by_kind = EXCLUDED.revoked_by_kind,
        revoked_by_id = EXCLUDED.revoked_by_id,
        revocation_reason = EXCLUDED.revocation_reason`,
      [
        key.id,
        key.hash,
        key.owner.kind,
        key.owner.id,
        key.name ?? null,
        key.description ?? null,
        key.createdBy?.kind ?? null,
        key.createdBy?.id ?? null,
        key.createdAt,
        key.updatedAt,
        key.expiresAt ?? null,
        key.lastUsedAt ?? null,
        key.usageCount,
        key.status,
        key.scopes,
        key.labels ?? {},
        key.metadata ?? null,
        key.revokedAt ?? null,
        key.revokedBy?.kind ?? null,
        key.revokedBy?.id ?? null,
        key.revocationReason ?? null,
      ],
    );
  }

  for (const event of seed.auditEvents ?? []) {
    await dataSource.executor.query(
      `INSERT INTO ${dataSource.tables.auditEvents} (
        id,
        occurred_at,
        category,
        action,
        actor,
        subject,
        resource,
        metadata,
        correlation_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9
      )
      ON CONFLICT (id) DO UPDATE SET
        occurred_at = EXCLUDED.occurred_at,
        category = EXCLUDED.category,
        action = EXCLUDED.action,
        actor = EXCLUDED.actor,
        subject = EXCLUDED.subject,
        resource = EXCLUDED.resource,
        metadata = EXCLUDED.metadata,
        correlation_id = EXCLUDED.correlation_id`,
      [
        event.id,
        event.occurredAt,
        event.category,
        event.action,
        event.actor ?? null,
        event.subject ?? null,
        event.resource ?? null,
        event.metadata ?? null,
        event.correlationId ?? null,
      ],
    );
  }
};
