import type { Pool } from "pg";

import type {
  CachePort,
  EffectiveIdentity,
  IdpAdapterPort,
  PolicyEnginePort,
} from "@catalyst-auth/contracts";
import {
  createPostgresDataSource,
  createPostgresDataSourceFromPool,
  type CreatePostgresDataSourceOptions,
  type PostgresDataSource,
  type PostgresCacheOptions,
} from "@catalyst-auth/data-postgres";

import { ForwardAuthService } from "./forward-auth-service.js";
import type { ForwardAuthConfig } from "./types.js";

export interface PostgresForwardAuthRuntime {
  readonly dataSource: PostgresDataSource;
  readonly service: ForwardAuthService;
}

export type PostgresForwardAuthConfig = Omit<ForwardAuthConfig, "auditLog" | "keyStore" | "sessionStore">;

export interface CreatePostgresForwardAuthRuntimeOptions {
  readonly idp: IdpAdapterPort;
  readonly policyEngine: PolicyEnginePort;
  readonly dataSource?: PostgresDataSource;
  readonly pool?: Pool;
  readonly dataSourceOptions?: Omit<CreatePostgresDataSourceOptions, "pool">;
  readonly forwardAuth?: PostgresForwardAuthConfig;
  readonly cache?: PostgresForwardAuthCacheOptions;
}

export interface PostgresForwardAuthCacheOptions {
  readonly effectiveIdentityCache?: CachePort<EffectiveIdentity>;
  readonly effectiveIdentityCacheKeyPrefix?: string;
  readonly effectiveIdentityCacheTtlSeconds?: number;
}

export const createPostgresForwardAuthRuntime = (
  options: CreatePostgresForwardAuthRuntimeOptions,
): PostgresForwardAuthRuntime => {
  const dataSource = resolveDataSource(options);
  const service = new ForwardAuthService(
    { idp: options.idp, policyEngine: options.policyEngine },
    {
      ...(options.forwardAuth ?? {}),
      auditLog: dataSource.auditLog,
      keyStore: dataSource.keyStore,
      sessionStore: dataSource.sessionStore,
    },
  );

  return { dataSource, service };
};

const resolveDataSource = (
  options: CreatePostgresForwardAuthRuntimeOptions,
): PostgresDataSource => {
  if (options.dataSource) {
    return options.dataSource;
  }

  const cacheOptions = mergeCacheOptions(options);

  if (options.pool) {
    return createPostgresDataSourceFromPool(options.pool, {
      ...options.dataSourceOptions,
      cacheOptions,
    });
  }

  if (options.dataSourceOptions?.executor) {
    return createPostgresDataSource({
      ...options.dataSourceOptions,
      cacheOptions,
    });
  }

  throw new Error("createPostgresForwardAuthRuntime requires a data source, pool, or executor");
};

const mergeCacheOptions = (
  options: CreatePostgresForwardAuthRuntimeOptions,
): PostgresCacheOptions | undefined => {
  const base = options.dataSourceOptions?.cacheOptions;
  const decisionCache = options.forwardAuth?.decisionCache ?? base?.decisionCache;
  const effectiveIdentityCache = options.cache?.effectiveIdentityCache ?? base?.effectiveIdentityCache;
  const effectiveIdentityCacheKeyPrefix =
    options.cache?.effectiveIdentityCacheKeyPrefix ?? base?.effectiveIdentityCacheKeyPrefix;
  const effectiveIdentityCacheTtlSeconds =
    options.cache?.effectiveIdentityCacheTtlSeconds ?? base?.effectiveIdentityCacheTtlSeconds;

  if (!decisionCache && !effectiveIdentityCache && !base) {
    return undefined;
  }

  return {
    decisionCache,
    effectiveIdentityCache,
    effectiveIdentityCacheKeyPrefix,
    effectiveIdentityCacheTtlSeconds,
  } satisfies PostgresCacheOptions;
};
