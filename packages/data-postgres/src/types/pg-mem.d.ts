declare module "pg-mem" {
  interface PgPoolLike {
    new (): import("pg").Pool;
  }

  interface PgAdapters {
    createPg(): {
      Pool: PgPoolLike;
    };
  }

  interface MemoryDb {
    adapters: PgAdapters;
    public: {
      none(sql: string): unknown;
    };
  }

  export function newDb(options?: { autoCreateForeignKeyIndices?: boolean }): MemoryDb;
}
