import type {
  AuditLogPort,
  EntitlementStorePort,
  KeyStorePort,
  ProfileStorePort,
  SessionStorePort,
} from "@catalyst-auth/contracts";
import type { Pool } from "pg";

import { createPgQueryExecutor } from "./executors/pg-query-executor.js";
import type { QueryExecutor } from "./executors/query-executor.js";
import { createPostgresAuditLog } from "./repositories/audit-repository.js";
import { createPostgresEntitlementStore } from "./repositories/entitlement-repository.js";
import { createPostgresKeyStore } from "./repositories/key-repository.js";
import { createPostgresProfileStore } from "./repositories/profile-repository.js";
import { createPostgresSessionStore } from "./repositories/session-repository.js";
import { PostgresTransactionManager } from "./transactions/transaction-manager.js";

export interface PostgresTableNames {
  readonly users: string;
  readonly orgs: string;
  readonly groups: string;
  readonly memberships: string;
  readonly entitlements: string;
  readonly sessions: string;
  readonly keys: string;
  readonly auditEvents: string;
  readonly webhookSubscriptions: string;
  readonly webhookDeliveries: string;
}

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

export interface PostgresDataSource {
  readonly executor: QueryExecutor;
  readonly tables: PostgresTableNames;
  readonly profileStore: ProfileStorePort;
  readonly entitlementStore: EntitlementStorePort;
  readonly keyStore: KeyStorePort;
  readonly auditLog: AuditLogPort;
  readonly sessionStore: SessionStorePort;
  readonly transactionManager: PostgresTransactionManager;
}

export interface CreatePostgresDataSourceOptions {
  readonly pool?: Pool;
  readonly executor?: QueryExecutor;
  readonly tables?: Partial<PostgresTableNames>;
}

export const createPostgresDataSource = (
  options: CreatePostgresDataSourceOptions,
): PostgresDataSource => {
  const tables: PostgresTableNames = { ...defaultTables, ...(options.tables ?? {}) };
  const executor = options.executor ?? (options.pool ? createPgQueryExecutor(options.pool) : undefined);

  if (!executor) {
    throw new Error("createPostgresDataSource requires a pool or executor");
  }

  const entitlementStore = createPostgresEntitlementStore(executor, { tables });
  const profileStore = createPostgresProfileStore(executor, { tables });
  const keyStore = createPostgresKeyStore(executor, { tables });
  const auditLog = createPostgresAuditLog(executor, { tables });
  const sessionStore = createPostgresSessionStore(executor, { tables });
  const transactionManager = new PostgresTransactionManager({ pool: options.pool, executor });

  return {
    executor,
    tables,
    profileStore,
    entitlementStore,
    keyStore,
    auditLog,
    sessionStore,
    transactionManager,
  };
};

export const createPostgresDataSourceFromPool = (
  pool: Pool,
  options: Omit<CreatePostgresDataSourceOptions, "pool" | "executor"> = {},
): PostgresDataSource => createPostgresDataSource({ ...options, pool });
