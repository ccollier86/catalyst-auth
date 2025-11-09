export interface QueryResult<Row> {
  readonly rows: ReadonlyArray<Row>;
}

export interface QueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResult<Row>>;
}
