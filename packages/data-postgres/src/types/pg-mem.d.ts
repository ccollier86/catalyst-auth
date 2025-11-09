declare module "pg-mem" {
  export interface PgMemAdapters {
    createPg(): { Pool: new () => import("pg").Pool };
  }

  export interface PgMemDatabaseOptions {
    autoCreateForeignKeyIndices?: boolean;
  }

  export interface PgMemDatabase {
    public: {
      none(sql: string): void;
      many(sql: string): ReadonlyArray<Record<string, unknown>>;
    };
    adapters: PgMemAdapters;
  }

  export function newDb(options?: PgMemDatabaseOptions): PgMemDatabase;
}
