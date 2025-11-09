import type { Pool } from "pg";

import type { IdpAdapterPort, PolicyEnginePort } from "@catalyst-auth/contracts";
import {
  createPostgresDataSource,
  createPostgresDataSourceFromPool,
  type CreatePostgresDataSourceOptions,
  type PostgresDataSource,
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

  if (options.pool) {
    return createPostgresDataSourceFromPool(options.pool, options.dataSourceOptions);
  }

  if (options.dataSourceOptions?.executor) {
    return createPostgresDataSource(options.dataSourceOptions);
  }

  throw new Error("createPostgresForwardAuthRuntime requires a data source, pool, or executor");
};
