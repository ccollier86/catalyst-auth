import { readFile } from "node:fs/promises";

import type { AuditEventRecord } from "@catalyst-auth/contracts";
import { newDb } from "pg-mem";

import { createPostgresDataSourceFromPool, type PostgresDataSource } from "../postgres-data-source.js";
import { seedPostgresDataSource, type PostgresSeedData } from "../seeding/seed.js";
import { clone } from "../utils/clone.js";
import { postgresMigrations } from "../migrations/index.js";

export interface TestPostgresDataSource extends PostgresDataSource {
  seed(seed: PostgresSeedData): Promise<void>;
  listAuditEvents(): ReadonlyArray<AuditEventRecord>;
}

export const createTestPostgresDataSource = async (
  seed?: PostgresSeedData,
): Promise<TestPostgresDataSource> => {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  for (const migration of postgresMigrations) {
    const migrationUrl = new URL(`../migrations/${migration.filename}`, import.meta.url);
    const migrationSql = await readFile(migrationUrl, "utf-8");
    db.public.none(migrationSql);
  }

  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  const dataSource = createPostgresDataSourceFromPool(pool);
  if (seed) {
    await seedPostgresDataSource(dataSource, seed);
  }

  return {
    ...dataSource,
    seed: async (data: PostgresSeedData) => {
      await seedPostgresDataSource(dataSource, data);
    },
    listAuditEvents: (): ReadonlyArray<AuditEventRecord> => {
      const rows = db.public.many(
        `SELECT * FROM ${dataSource.tables.auditEvents} ORDER BY occurred_at ASC, id ASC`,
      ) as ReadonlyArray<{
        id: string;
        occurred_at: string;
        category: string;
        action: string;
        actor: Record<string, unknown> | null;
        subject: Record<string, unknown> | null;
        resource: Record<string, unknown> | null;
        metadata: Record<string, unknown> | null;
        correlation_id: string | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        category: row.category,
        action: row.action,
        actor: row.actor ? (clone(row.actor) as unknown as AuditEventRecord["actor"]) : undefined,
        subject: row.subject ? (clone(row.subject) as unknown as AuditEventRecord["subject"]) : undefined,
        resource: row.resource ? (clone(row.resource) as unknown as AuditEventRecord["resource"]) : undefined,
        metadata: row.metadata ? clone(row.metadata) : undefined,
        correlationId: row.correlation_id ?? undefined,
      }));
    },
  };
};
