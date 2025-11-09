import type { Pool, PoolClient, QueryResult as PgQueryResult } from "pg";

import type { QueryExecutor, QueryResult } from "./query-executor.js";

export type PgQueryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export const createPgQueryExecutor = (queryable: PgQueryable): QueryExecutor => ({
  async query<Row = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<QueryResult<Row>> {
    const result = (await queryable.query<Row>(sql, params)) as PgQueryResult<Row>;
    return { rows: result.rows };
  },
});
