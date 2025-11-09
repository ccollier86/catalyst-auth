import type { AuditLogPort, KeyStorePort, ProfileStorePort } from "@catalyst-auth/contracts";

import { createPostgresAuditLog } from "./repositories/audit-repository.js";
import { createPostgresKeyStore } from "./repositories/key-repository.js";
import { createPostgresProfileStore } from "./repositories/profile-repository.js";
import { InMemoryPostgresDatabase } from "./testing/in-memory-database.js";
import { PostgresTransactionManager } from "./transactions/transaction-manager.js";

export interface PostgresDataSource {
  readonly database: InMemoryPostgresDatabase;
  readonly profileStore: ProfileStorePort;
  readonly keyStore: KeyStorePort;
  readonly auditLog: AuditLogPort;
  readonly transactionManager: PostgresTransactionManager;
}

export interface CreatePostgresDataSourceOptions {
  readonly database?: InMemoryPostgresDatabase;
}

export const createPostgresDataSource = (
  options: CreatePostgresDataSourceOptions = {},
): PostgresDataSource => {
  const database = options.database ?? new InMemoryPostgresDatabase();
  const profileStore = createPostgresProfileStore(database);
  const keyStore = createPostgresKeyStore(database);
  const auditLog = createPostgresAuditLog(database);
  const transactionManager = new PostgresTransactionManager(database);

  return {
    database,
    profileStore,
    keyStore,
    auditLog,
    transactionManager,
  };
};
