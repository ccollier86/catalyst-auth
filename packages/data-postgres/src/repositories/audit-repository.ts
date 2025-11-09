import { randomUUID } from "node:crypto";

import {
  err,
  ok,
  type AppendAuditEventInput,
  type AuditEventRecord,
  type AuditLogPort,
  type CatalystError,
  type Result,
} from "@catalyst-auth/contracts";

import type { PostgresTableNames } from "../tables.js";
import type { QueryExecutor } from "../executors/query-executor.js";
import { clone } from "../utils/clone.js";

interface Clock {
  now(): Date;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

interface AuditEventRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly category: string;
  readonly action: string;
  readonly actor: Record<string, unknown> | null;
  readonly subject: Record<string, unknown> | null;
  readonly resource: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
  readonly correlation_id: string | null;
}

const toRecord = (row: AuditEventRow): AuditEventRecord => ({
  id: row.id,
  occurredAt: row.occurred_at,
  category: row.category,
  action: row.action,
  actor: row.actor ? (clone(row.actor) as unknown as AuditEventRecord["actor"]) : undefined,
  subject: row.subject ? (clone(row.subject) as unknown as AuditEventRecord["subject"]) : undefined,
  resource: row.resource ? (clone(row.resource) as unknown as AuditEventRecord["resource"]) : undefined,
  metadata: row.metadata ? clone(row.metadata) : undefined,
  correlationId: row.correlation_id ?? undefined,
});

interface PostgresAuditLogOptions {
  readonly tables?: Pick<PostgresTableNames, "auditEvents">;
  readonly clock?: Clock;
}

const createError = (code: string, message: string, details?: Record<string, unknown>): CatalystError => ({
  code,
  message,
  details,
});

export class PostgresAuditLog implements AuditLogPort {
  private readonly table: string;
  private readonly clock: Clock;

  constructor(
    private readonly executor: QueryExecutor,
    options: PostgresAuditLogOptions = {},
  ) {
    this.table = options.tables?.auditEvents ?? "auth_audit_events";
    this.clock = options.clock ?? defaultClock;
  }

  async appendEvent(input: AppendAuditEventInput): Promise<Result<AuditEventRecord, CatalystError>> {
    if (!input.category?.trim()) {
      return err(createError("audit.postgres.invalid_category", "Category is required"));
    }
    if (!input.action?.trim()) {
      return err(createError("audit.postgres.invalid_action", "Action is required"));
    }

    const occurredAt = input.occurredAt ?? this.clock.now().toISOString();
    const id = randomUUID();

    const { rows } = await this.executor.query<AuditEventRow>(
      `INSERT INTO ${this.table} (
        id,
        occurred_at,
        category,
        action,
        actor,
        subject,
        resource,
        metadata,
        correlation_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9
      )
      RETURNING *`,
      [
        id,
        occurredAt,
        input.category,
        input.action,
        input.actor ?? null,
        input.subject ?? null,
        input.resource ?? null,
        input.metadata ?? null,
        input.correlationId ?? null,
      ],
    );

    return ok(toRecord(rows[0]));
  }

  async listEvents(): Promise<Result<ReadonlyArray<AuditEventRecord>, CatalystError>> {
    const { rows } = await this.executor.query<AuditEventRow>(
      `SELECT * FROM ${this.table} ORDER BY occurred_at ASC, id ASC`,
    );
    return ok(rows.map((row) => toRecord(row)));
  }
}

export const createPostgresAuditLog = (
  executor: QueryExecutor,
  options?: PostgresAuditLogOptions,
): AuditLogPort => new PostgresAuditLog(executor, options);
