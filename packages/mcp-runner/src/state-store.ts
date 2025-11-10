export interface StoredActionState {
  readonly specHash: string;
  readonly appliedAt: string;
}

export interface McpStateStore {
  readonly read: (runbookName: string, actionId: string) => Promise<StoredActionState | null>;
  readonly write: (
    runbookName: string,
    actionId: string,
    specHash: string,
    appliedAt: string,
  ) => Promise<void>;
  readonly remove: (runbookName: string, actionId: string) => Promise<void>;
}

export interface SqlClient {
  query: (queryText: string, values?: ReadonlyArray<unknown>) => Promise<{ rowCount: number; rows: any[] }>;
}

const ensureSchema = async (client: SqlClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mcp_run_state (
      runbook text NOT NULL,
      action_id text NOT NULL,
      spec_hash text NOT NULL,
      applied_at timestamptz NOT NULL,
      PRIMARY KEY (runbook, action_id)
    )
  `);
};

export const createPostgresStateStore = (client: SqlClient): McpStateStore => {
  let schemaReady: Promise<void> | null = null;

  const ensureReady = () => {
    if (!schemaReady) {
      schemaReady = ensureSchema(client);
    }
    return schemaReady;
  };

  return {
    read: async (runbookName, actionId) => {
      await ensureReady();
      const result = await client.query(
        `SELECT spec_hash, applied_at FROM mcp_run_state WHERE runbook = $1 AND action_id = $2`,
        [runbookName, actionId],
      );
      if (result.rowCount === 0) {
        return null;
      }
      const row = result.rows[0] as { spec_hash: string; applied_at: Date };
      return {
        specHash: row.spec_hash,
        appliedAt: row.applied_at.toISOString(),
      };
    },
    write: async (runbookName, actionId, specHash, appliedAt) => {
      await ensureReady();
      await client.query(
        `INSERT INTO mcp_run_state (runbook, action_id, spec_hash, applied_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (runbook, action_id)
         DO UPDATE SET spec_hash = excluded.spec_hash, applied_at = excluded.applied_at`,
        [runbookName, actionId, specHash, appliedAt],
      );
    },
    remove: async (runbookName, actionId) => {
      await ensureReady();
      await client.query(`DELETE FROM mcp_run_state WHERE runbook = $1 AND action_id = $2`, [runbookName, actionId]);
    },
  };
};
