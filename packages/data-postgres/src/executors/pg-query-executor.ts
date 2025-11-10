import type { Pool, PoolClient, QueryResult as PgQueryResult } from "pg";

import { runWithSpan } from "@catalyst-auth/telemetry";

import type { PostgresTelemetryContext } from "../telemetry.js";
import type { QueryExecutor, QueryResult } from "./query-executor.js";

export type PgQueryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export interface CreatePgQueryExecutorOptions {
  readonly telemetry?: PostgresTelemetryContext;
}

const truncateStatement = (sql: string, limit = 200): string =>
  sql.length > limit ? `${sql.slice(0, limit)}…` : sql;

export const createPgQueryExecutor = (
  queryable: PgQueryable,
  options: CreatePgQueryExecutorOptions = {},
): QueryExecutor => ({
  async query<Row = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<Row>> {
    const telemetry = options.telemetry;
    if (!telemetry) {
      const result = (await queryable.query<Row>(sql, params)) as PgQueryResult<Row>;
      return { rows: result.rows } satisfies QueryResult<Row>;
    }

    const start = performance.now();
    let outcome: "ok" | "error" = "ok";

    try {
      const result = await runWithSpan(
        telemetry.tracer,
        "postgres.query",
        async (span) => {
          span.setAttribute("db.system", "postgresql");
          span.setAttribute("db.operation", "query");
          span.setAttribute("db.statement", sql);
          span.setAttribute("db.sql.parameters_length", params.length);
          telemetry.logger.debug("postgres.query.start", {
            statement: truncateStatement(sql),
            parameterCount: params.length,
          });
          const queryResult = (await queryable.query<Row>(sql, params)) as PgQueryResult<Row>;
          span.setAttribute("db.rows_returned", queryResult.rowCount ?? queryResult.rows.length ?? 0);
          return queryResult;
        },
        {
          onError: (error) => {
            outcome = "error";
            const message = error instanceof Error ? error.message : String(error);
            telemetry.logger.error("postgres.query.failed", {
              statement: truncateStatement(sql),
              error: message,
            });
          },
        },
      );

      const duration = performance.now() - start;
      telemetry.logger.debug("postgres.query.success", {
        statement: truncateStatement(sql),
        durationMs: duration,
      });
      telemetry.metrics.queryCounter.add(1, { outcome, operation: "query" });
      telemetry.metrics.queryDuration.record(duration, { outcome, operation: "query" });
      return { rows: result.rows } satisfies QueryResult<Row>;
    } catch (error) {
      outcome = "error";
      const duration = performance.now() - start;
      telemetry.metrics.queryCounter.add(1, { outcome, operation: "query" });
      telemetry.metrics.queryDuration.record(duration, { outcome, operation: "query" });
      throw error;
    }
  },
});
