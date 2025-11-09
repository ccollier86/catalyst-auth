export interface QueryResult<T = unknown> {
  readonly rows: ReadonlyArray<T>;
}

export interface Queryable {
  query<T = unknown>(sql: string, params?: ReadonlyArray<unknown>): Promise<QueryResult<T>>;
}

export interface Clock {
  now(): Date;
}

type IdFactory = () => string;

export interface PostgresKeyStoreOptions {
  readonly queryable: Queryable;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
  readonly tableName?: string;
}
