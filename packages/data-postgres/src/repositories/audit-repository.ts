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

import { InMemoryPostgresDatabase } from "../testing/in-memory-database.js";
import { clone } from "../utils/clone.js";

interface Clock {
  now(): Date;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

const createError = (code: string, message: string, details?: Record<string, unknown>): CatalystError => ({
  code,
  message,
  details,
});

const defaultDatabase = new InMemoryPostgresDatabase();

export class PostgresAuditLog implements AuditLogPort {
  private readonly clock: Clock;

  constructor(private readonly database: InMemoryPostgresDatabase = defaultDatabase, clock: Clock = defaultClock) {
    this.clock = clock;
  }

  async appendEvent(input: AppendAuditEventInput): Promise<Result<AuditEventRecord, CatalystError>> {
    if (!input.category?.trim()) {
      return err(createError("audit.postgres.invalid_category", "Category is required"));
    }
    if (!input.action?.trim()) {
      return err(createError("audit.postgres.invalid_action", "Action is required"));
    }

    const occurredAt = input.occurredAt ?? this.clock.now().toISOString();
    const record: AuditEventRecord = {
      id: randomUUID(),
      occurredAt,
      category: input.category,
      action: input.action,
      actor: input.actor ? clone(input.actor) : undefined,
      subject: input.subject ? clone(input.subject) : undefined,
      resource: input.resource ? clone(input.resource) : undefined,
      metadata: input.metadata ? clone(input.metadata) : undefined,
      correlationId: input.correlationId,
    };

    this.database.recordAuditEvent(record);
    return ok(clone(record));
  }

  async listEvents(): Promise<Result<ReadonlyArray<AuditEventRecord>, CatalystError>> {
    const events = Array.from(this.database.auditEvents.values()).map((event) => clone(event));
    events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    return ok(events);
  }
}

export const createPostgresAuditLog = (
  database?: InMemoryPostgresDatabase,
  clock?: Clock,
): AuditLogPort => new PostgresAuditLog(database, clock ?? defaultClock);
