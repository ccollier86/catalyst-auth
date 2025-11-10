import type { Pool } from "pg";

import { runWithSpan } from "@catalyst-auth/telemetry";

import { createPgQueryExecutor } from "../executors/pg-query-executor.js";
import type { QueryExecutor } from "../executors/query-executor.js";
import type { PostgresTelemetryContext } from "../telemetry.js";

export type TransactionCallback<T> = (executor: QueryExecutor) => Promise<T> | T;

interface TransactionManagerOptions {
  readonly pool?: Pool;
  readonly executor?: QueryExecutor;
  readonly telemetry?: PostgresTelemetryContext;
}

export class PostgresTransactionManager {
  private readonly pool?: Pool;
  private readonly executor?: QueryExecutor;
  private readonly telemetry?: PostgresTelemetryContext;

  constructor(options: TransactionManagerOptions) {
    if (!options.pool && !options.executor) {
      throw new Error("PostgresTransactionManager requires a pool or executor");
    }
    this.pool = options.pool;
    this.executor = options.executor;
    this.telemetry = options.telemetry;
  }

  async runInTransaction<T>(callback: TransactionCallback<T>): Promise<T> {
    if (!this.pool) {
      if (!this.executor) {
        throw new Error("PostgresTransactionManager misconfigured without executor");
      }
      if (!this.telemetry) {
        return callback(this.executor);
      }

      return runWithSpan(
        this.telemetry.tracer,
        "postgres.transaction",
        async (span) => {
          span.setAttribute("db.system", "postgresql");
          span.setAttribute("db.operation", "transaction");
          this.telemetry!.logger.debug("postgres.transaction.inline", {
            mode: "executor",
          });
          const result = await callback(this.executor!);
          this.telemetry!.logger.debug("postgres.transaction.inline_completed", {
            mode: "executor",
          });
          return result;
        },
      );
    }

    const client = await this.pool.connect();
    const telemetry = this.telemetry;
    const start = performance.now();
    let outcome: "ok" | "error" = "ok";
    try {
      if (!telemetry) {
        await client.query("BEGIN");
        const executor = createPgQueryExecutor(client);
        const result = await callback(executor);
        await client.query("COMMIT");
        return result;
      }

      return await runWithSpan(
        telemetry.tracer,
        "postgres.transaction",
        async (span) => {
          span.setAttribute("db.system", "postgresql");
          span.setAttribute("db.operation", "transaction");
          telemetry.logger.debug("postgres.transaction.begin", {});
          await client.query("BEGIN");
          const executor = createPgQueryExecutor(client, { telemetry });
          const result = await callback(executor);
          await client.query("COMMIT");
          telemetry.logger.info("postgres.transaction.commit", {
            durationMs: performance.now() - start,
          });
          return result;
        },
        {
          onError: (error) => {
            outcome = "error";
            const message = error instanceof Error ? error.message : String(error);
            telemetry.logger.error("postgres.transaction.failed", { error: message });
          },
        },
      );
    } catch (error) {
      outcome = "error";
      try {
        await client.query("ROLLBACK");
        telemetry?.logger.warn("postgres.transaction.rollback", {});
      } catch {
        // Best-effort rollback; suppress secondary errors.
        telemetry?.logger.error("postgres.transaction.rollback_failed", {});
      }
      throw error;
    } finally {
      if (telemetry) {
        const duration = performance.now() - start;
        telemetry.metrics.transactionCounter.add(1, { outcome });
        telemetry.metrics.transactionDuration.record(duration, { outcome });
      }
      client.release();
    }
  }
}
