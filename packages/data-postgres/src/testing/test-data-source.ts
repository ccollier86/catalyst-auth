import type { AuditEventRecord } from "@catalyst-auth/contracts";

import { createPostgresDataSource, type PostgresDataSource } from "../postgres-data-source.js";
import { seedPostgresDataSource, type PostgresSeedData } from "../seeding/seed.js";
import { InMemoryPostgresDatabase } from "./in-memory-database.js";
import { InMemoryQueryExecutor } from "./in-memory-query-executor.js";

const defaultTables = {
  users: "auth_users",
  orgs: "auth_orgs",
  groups: "auth_groups",
  memberships: "auth_memberships",
  entitlements: "auth_entitlements",
  sessions: "auth_sessions",
  keys: "auth_keys",
  auditEvents: "auth_audit_events",
  webhookSubscriptions: "auth_webhook_subscriptions",
  webhookDeliveries: "auth_webhook_deliveries",
} as const;

export interface TestPostgresDataSource extends PostgresDataSource {
  seed(seed: PostgresSeedData): Promise<void>;
  listAuditEvents(): ReadonlyArray<AuditEventRecord>;
}

export const createTestPostgresDataSource = async (
  seed?: PostgresSeedData,
): Promise<TestPostgresDataSource> => {
  const database = new InMemoryPostgresDatabase();
  const executor = new InMemoryQueryExecutor(database, defaultTables);

  const dataSource = createPostgresDataSource({ executor, tables: { ...defaultTables } });
  if (seed) {
    await seedPostgresDataSource(dataSource, seed);
  }

  return {
    ...dataSource,
    seed: async (data: PostgresSeedData) => {
      await seedPostgresDataSource(dataSource, data);
    },
    listAuditEvents: () => database.snapshotAuditEvents(),
  };
};
