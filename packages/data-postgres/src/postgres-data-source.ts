import type {
  AuditLogPort,
  CachePort,
  EntitlementStorePort,
  KeyStorePort,
  ProfileStorePort,
  SessionStorePort,
  WebhookDeliveryStorePort,
  WebhookSubscriptionStorePort,
  EffectiveIdentity,
} from "@catalyst-auth/contracts";
import type { Pool } from "pg";

import { createPgQueryExecutor } from "./executors/pg-query-executor.js";
import type { QueryExecutor } from "./executors/query-executor.js";
import { createPostgresAuditLog } from "./repositories/audit-repository.js";
import { createPostgresEntitlementStore } from "./repositories/entitlement-repository.js";
import { createPostgresKeyStore } from "./repositories/key-repository.js";
import { createPostgresProfileStore } from "./repositories/profile-repository.js";
import { createPostgresSessionStore } from "./repositories/session-repository.js";
import {
  createPostgresWebhookDeliveryStore,
  createPostgresWebhookSubscriptionStore,
} from "./repositories/webhook-repository.js";
import { PostgresTransactionManager } from "./transactions/transaction-manager.js";
import { resolvePostgresTableNames, type PostgresTableNames } from "./tables.js";
import { PostgresCacheInvalidator } from "./utils/cache-invalidation.js";

export interface PostgresDataSource {
  readonly executor: QueryExecutor;
  readonly tables: PostgresTableNames;
  readonly profileStore: ProfileStorePort;
  readonly entitlementStore: EntitlementStorePort;
  readonly keyStore: KeyStorePort;
  readonly auditLog: AuditLogPort;
  readonly sessionStore: SessionStorePort;
  readonly webhookSubscriptionStore: WebhookSubscriptionStorePort;
  readonly webhookDeliveryStore: WebhookDeliveryStorePort;
  readonly transactionManager: PostgresTransactionManager;
}

export interface CreatePostgresDataSourceOptions {
  readonly pool?: Pool;
  readonly executor?: QueryExecutor;
  readonly tables?: Partial<PostgresTableNames>;
  readonly cacheOptions?: PostgresCacheOptions;
}

export interface PostgresCacheOptions {
  readonly decisionCache?: CachePort;
  readonly effectiveIdentityCache?: CachePort<EffectiveIdentity>;
  readonly effectiveIdentityCacheKeyPrefix?: string;
  readonly effectiveIdentityCacheTtlSeconds?: number;
}

export const createPostgresDataSource = (
  options: CreatePostgresDataSourceOptions,
): PostgresDataSource => {
  const tables = resolvePostgresTableNames(options.tables);
  let executor = options.executor;

  if (!executor && options.pool) {
    executor = createPgQueryExecutor(options.pool);
  }

  if (!executor) {
    throw new Error("createPostgresDataSource requires a pool or query executor");
  }

  const cacheInvalidator = new PostgresCacheInvalidator({
    decisionCache: options.cacheOptions?.decisionCache,
    effectiveIdentityCache: options.cacheOptions?.effectiveIdentityCache,
  });

  const profileStore = createPostgresProfileStore(executor, {
    tables,
    cacheInvalidator,
    identityCache: options.cacheOptions?.effectiveIdentityCache,
    identityCacheKeyPrefix: options.cacheOptions?.effectiveIdentityCacheKeyPrefix,
    identityCacheTtlSeconds: options.cacheOptions?.effectiveIdentityCacheTtlSeconds,
  });
  const entitlementStore = createPostgresEntitlementStore(executor, {
    tables,
    cacheInvalidator,
  });
  const keyStore = createPostgresKeyStore(executor, { tables });
  const auditLog = createPostgresAuditLog(executor, { tables });
  const sessionStore = createPostgresSessionStore(executor, { tables });
  const webhookSubscriptionStore = createPostgresWebhookSubscriptionStore(executor, { tables });
  const webhookDeliveryStore = createPostgresWebhookDeliveryStore(executor, { tables });
  const transactionManager = new PostgresTransactionManager({ pool: options.pool, executor });

  return {
    executor,
    tables,
    profileStore,
    entitlementStore,
    keyStore,
    auditLog,
    sessionStore,
    webhookSubscriptionStore,
    webhookDeliveryStore,
    transactionManager,
  };
};

export const createPostgresDataSourceFromPool = (
  pool: Pool,
  options: Omit<CreatePostgresDataSourceOptions, "pool" | "executor"> = {},
): PostgresDataSource => createPostgresDataSource({ ...options, pool });
