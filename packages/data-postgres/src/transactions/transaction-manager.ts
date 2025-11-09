import type { Pool } from "pg";

import { createPgQueryExecutor } from "../executors/pg-query-executor.js";
import type { QueryExecutor } from "../executors/query-executor.js";

export type TransactionCallback<T> = (executor: QueryExecutor) => Promise<T> | T;

interface TransactionManagerOptions {
  readonly pool?: Pool;
  readonly executor?: QueryExecutor;
}

export class PostgresTransactionManager {
  private readonly pool?: Pool;
  private readonly executor?: QueryExecutor;

  constructor(options: TransactionManagerOptions) {
    if (!options.pool && !options.executor) {
      throw new Error("PostgresTransactionManager requires a pool or executor");
    }
    this.pool = options.pool;
    this.executor = options.executor;
  }

  async runInTransaction<T>(callback: TransactionCallback<T>): Promise<T> {
    if (!this.pool) {
      if (!this.executor) {
        throw new Error("PostgresTransactionManager misconfigured without executor");
      }
      return callback(this.executor);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const executor = createPgQueryExecutor(client);
      const result = await callback(executor);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Best-effort rollback; suppress secondary errors.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
