import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AuditEventRecord } from "@catalyst-auth/contracts";

import { createPgQueryExecutor } from "../executors/pg-query-executor.js";
import type { QueryExecutor } from "../executors/query-executor.js";
import {
  createPostgresDataSource,
  type PostgresDataSource,
  type PostgresTableNames,
} from "../postgres-data-source.js";
import { postgresMigrations } from "../migrations/index.js";
import { seedPostgresDataSource, type PostgresSeedData } from "../seeding/seed.js";
import { createFallbackHarness } from "./fallback-query-executor.js";

const defaultTables: PostgresTableNames = {
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
};

const migrationsDir = dirname(fileURLToPath(new URL("../migrations/", import.meta.url)));

const runMigrations = async (db: { public: { none(sql: string): unknown } }): Promise<void> => {
  for (const migration of postgresMigrations) {
    const sql = await readFile(join(migrationsDir, migration.filename), "utf8");
    db.public.none(sql);
  }
};

export interface TestPostgresDataSource extends PostgresDataSource {
  seed(seed: PostgresSeedData): Promise<void>;
  listAuditEvents(): Promise<ReadonlyArray<AuditEventRecord>>;
}

interface TestExecutorResult {
  readonly executor: QueryExecutor;
  readonly dispose: () => Promise<void>;
  readonly listAuditEvents: () => Promise<ReadonlyArray<AuditEventRecord>>;
}

const createPgMemExecutor = async (tables: PostgresTableNames): Promise<TestExecutorResult> => {
  const { newDb } = await import("pg-mem");
  const db = newDb({ autoCreateForeignKeyIndices: true });
  await runMigrations(db);
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  const executor = createPgQueryExecutor(pool);
  const listAuditEvents = async (): Promise<ReadonlyArray<AuditEventRecord>> => {
    const { rows } = await executor.query<AuditEventRecord>(
      `SELECT 
        id,
        occurred_at AS "occurredAt",
        category,
        action,
        actor,
        subject,
        resource,
        metadata,
        correlation_id AS "correlationId"
      FROM ${tables.auditEvents}
      ORDER BY occurred_at ASC`,
    );
    return rows;
  };

  return { executor, dispose: () => pool.end(), listAuditEvents };
};

const createFallbackExecutor = (tables: PostgresTableNames): TestExecutorResult => {
  const harness = createFallbackHarness(tables);
  return {
    executor: harness.executor,
    dispose: async () => {},
    listAuditEvents: async () => harness.listAuditEvents(),
  };
};

export const createTestPostgresDataSource = async (
  seed?: PostgresSeedData,
): Promise<TestPostgresDataSource> => {
  const tables: PostgresTableNames = { ...defaultTables };

  let executorResult: TestExecutorResult;
  try {
    executorResult = await createPgMemExecutor(tables);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    executorResult = createFallbackExecutor(tables);
  }

  const dataSource = createPostgresDataSource({ executor: executorResult.executor, tables });
  if (seed) {
    await seedPostgresDataSource(dataSource, seed);
  }

  return {
    ...dataSource,
    seed: async (data: PostgresSeedData) => {
      await seedPostgresDataSource(dataSource, data);
    },
    listAuditEvents: () => executorResult.listAuditEvents(),
  };
};
