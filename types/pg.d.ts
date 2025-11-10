declare module "pg" {
  export interface QueryResult<T = any> {
    rowCount: number;
    rows: T[];
  }

  export class Pool {
    constructor(config?: { connectionString?: string });
    query<T = any>(queryText: string, values?: any[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
}
