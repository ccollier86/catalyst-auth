import type { AuditEventRecord } from "@catalyst-auth/contracts";

import { createPostgresDataSource, type PostgresDataSource } from "../postgres-data-source.js";
import { seedPostgresDataSource, type PostgresSeedData } from "../seeding/seed.js";
import { clone } from "../utils/clone.js";

export interface TestPostgresDataSource extends PostgresDataSource {
  seed(seed: PostgresSeedData): Promise<void>;
  listAuditEvents(): ReadonlyArray<AuditEventRecord>;
}

export const createTestPostgresDataSource = async (
  seed?: PostgresSeedData,
): Promise<TestPostgresDataSource> => {
  const dataSource = createPostgresDataSource();
  if (seed) {
    await seedPostgresDataSource(dataSource, seed);
  }
  return {
    ...dataSource,
    seed: async (data: PostgresSeedData) => {
      await seedPostgresDataSource(dataSource, data);
    },
    listAuditEvents: () => Array.from(dataSource.database.auditEvents.values()).map((event) => clone(event)),
  };
};
