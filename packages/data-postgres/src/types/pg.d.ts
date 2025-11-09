declare module "pg" {
  export interface QueryResult<T = unknown> {
    rows: ReadonlyArray<T>;
  }

  export interface PoolClient {
    query<T = unknown>(text: string, values?: ReadonlyArray<unknown>): Promise<QueryResult<T>>;
    release(err?: Error): void;
  }

  export class Pool {
    query<T = unknown>(text: string, values?: ReadonlyArray<unknown>): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
