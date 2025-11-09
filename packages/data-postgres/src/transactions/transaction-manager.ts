import { InMemoryPostgresDatabase } from "../testing/in-memory-database.js";

export type TransactionCallback<T> = (context: {
  readonly database: InMemoryPostgresDatabase;
}) => Promise<T> | T;

export class PostgresTransactionManager {
  constructor(private readonly database: InMemoryPostgresDatabase) {}

  async runInTransaction<T>(callback: TransactionCallback<T>): Promise<T> {
    // In-memory harness executes callbacks directly. Hook for future transaction handling.
    return callback({ database: this.database });
  }
}
