import { randomUUID } from "node:crypto";

import {
  err,
  ok,
  type CatalystError,
  type CreateWebhookDeliveryInput,
  type CreateWebhookSubscriptionInput,
  type ListPendingDeliveriesOptions,
  type ListWebhookDeliveriesOptions,
  type ListWebhookSubscriptionsOptions,
  type Result,
  type UpdateWebhookDeliveryInput,
  type UpdateWebhookSubscriptionInput,
  type WebhookDeliveryRecord,
  type WebhookDeliveryStatus,
  type WebhookDeliveryStorePort,
  type WebhookRetryPolicy,
  type WebhookSubscriptionRecord,
  type WebhookSubscriptionStorePort,
} from "@catalyst-auth/contracts";

import type { QueryExecutor } from "../executors/query-executor.js";
import type { PostgresTableNames } from "../tables.js";
import { clone } from "../utils/clone.js";

type WebhookTables = Pick<PostgresTableNames, "webhookSubscriptions" | "webhookDeliveries">;

interface Clock {
  now(): Date;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

type IdFactory = () => string;

const defaultIdFactory: IdFactory = () => randomUUID();

const createError = (code: string, message: string, details?: Record<string, unknown>): CatalystError => ({
  code,
  message,
  details,
});

const dedupeStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
};

const normalizeHeaders = (headers: Record<string, string> | null | undefined): Record<string, string> => {
  if (!headers) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }
    normalized[key] = String(value);
  }
  return normalized;
};

const normalizeRetryPolicy = (
  policy: WebhookRetryPolicy | null | undefined,
): WebhookRetryPolicy | undefined => {
  if (!policy) {
    return undefined;
  }
  return {
    maxAttempts: policy.maxAttempts,
    backoffSeconds: [...policy.backoffSeconds],
    deadLetterUri: policy.deadLetterUri,
  };
};

const normalizePayload = (payload: Record<string, unknown>): Record<string, unknown> => clone(payload);

interface WebhookSubscriptionRow {
  readonly id: string;
  readonly org_id: string | null;
  readonly event_types: ReadonlyArray<string>;
  readonly target_url: string;
  readonly secret: string;
  readonly headers: Record<string, string> | null;
  readonly retry_policy: WebhookRetryPolicy | null;
  readonly active: boolean;
  readonly created_at: string;
  readonly updated_at: string;
  readonly metadata: Record<string, unknown> | null;
}

const toSubscriptionRecord = (row: WebhookSubscriptionRow): WebhookSubscriptionRecord => ({
  id: row.id,
  orgId: row.org_id ?? undefined,
  eventTypes: [...row.event_types],
  targetUrl: row.target_url,
  secret: row.secret,
  headers: normalizeHeaders(row.headers ?? {}),
  retryPolicy: normalizeRetryPolicy(row.retry_policy),
  active: row.active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  metadata: row.metadata ? clone(row.metadata) : undefined,
});

interface WebhookDeliveryRow {
  readonly id: string;
  readonly subscription_id: string;
  readonly event_id: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly last_attempt_at: string | null;
  readonly next_attempt_at: string | null;
  readonly payload: Record<string, unknown>;
  readonly response: Record<string, unknown> | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const toDeliveryRecord = (row: WebhookDeliveryRow): WebhookDeliveryRecord => ({
  id: row.id,
  subscriptionId: row.subscription_id,
  eventId: row.event_id,
  status: row.status as WebhookDeliveryStatus,
  attemptCount: Number(row.attempt_count ?? 0),
  lastAttemptAt: row.last_attempt_at ?? undefined,
  nextAttemptAt: row.next_attempt_at ?? undefined,
  payload: clone(row.payload ?? {}),
  response: row.response ? clone(row.response) : undefined,
  errorMessage: row.error_message ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

interface PostgresWebhookStoreOptions {
  readonly tables?: WebhookTables;
  readonly clock?: Clock;
  readonly idFactory?: IdFactory;
}

class PostgresWebhookSubscriptionStore implements WebhookSubscriptionStorePort {
  private readonly tables: WebhookTables;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly executor: QueryExecutor,
    options: PostgresWebhookStoreOptions = {},
  ) {
    this.tables = {
      webhookSubscriptions: options.tables?.webhookSubscriptions ?? "auth_webhook_subscriptions",
      webhookDeliveries: options.tables?.webhookDeliveries ?? "auth_webhook_deliveries",
    };
    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  async createSubscription(
    input: CreateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscriptionRecord, CatalystError>> {
    const eventTypes = dedupeStrings(input.eventTypes ?? []);
    if (eventTypes.length === 0) {
      return err(createError("webhook.postgres.event_types_required", "Webhook subscriptions require at least one event type."));
    }

    const id = input.id ?? this.idFactory();
    const createdAt = input.createdAt ?? this.clock.now().toISOString();
    const updatedAt = input.updatedAt ?? createdAt;

    try {
      const { rows } = await this.executor.query<WebhookSubscriptionRow>(
        `INSERT INTO ${this.tables.webhookSubscriptions} (
          id,
          org_id,
          event_types,
          target_url,
          secret,
          headers,
          retry_policy,
          active,
          created_at,
          updated_at,
          metadata
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        )
        RETURNING *`,
        [
          id,
          input.orgId ?? null,
          eventTypes,
          input.targetUrl,
          input.secret,
          normalizeHeaders(input.headers ?? {}),
          input.retryPolicy ?? null,
          input.active ?? true,
          createdAt,
          updatedAt,
          input.metadata ?? null,
        ],
      );

      return ok(toSubscriptionRecord(rows[0]));
    } catch (error) {
      return err(
        createError("webhook.postgres.create_failed", "Failed to create webhook subscription.", {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async updateSubscription(
    id: string,
    input: UpdateWebhookSubscriptionInput,
  ): Promise<Result<WebhookSubscriptionRecord, CatalystError>> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.orgId !== undefined) {
      updates.push(`org_id = $${paramIndex}`);
      values.push(input.orgId ?? null);
      paramIndex += 1;
    }

    if (input.eventTypes) {
      const eventTypes = dedupeStrings(input.eventTypes);
      if (eventTypes.length === 0) {
        return err(
          createError("webhook.postgres.event_types_required", "Webhook subscriptions require at least one event type."),
        );
      }
      updates.push(`event_types = $${paramIndex}`);
      values.push(eventTypes);
      paramIndex += 1;
    }

    if (input.targetUrl !== undefined) {
      updates.push(`target_url = $${paramIndex}`);
      values.push(input.targetUrl);
      paramIndex += 1;
    }

    if (input.secret !== undefined) {
      updates.push(`secret = $${paramIndex}`);
      values.push(input.secret);
      paramIndex += 1;
    }

    if (input.headers !== undefined) {
      updates.push(`headers = $${paramIndex}`);
      values.push(normalizeHeaders(input.headers ?? {}));
      paramIndex += 1;
    }

    if (input.retryPolicy !== undefined) {
      updates.push(`retry_policy = $${paramIndex}`);
      values.push(input.retryPolicy ?? null);
      paramIndex += 1;
    }

    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex}`);
      values.push(input.metadata ?? null);
      paramIndex += 1;
    }

    if (input.active !== undefined) {
      updates.push(`active = $${paramIndex}`);
      values.push(input.active);
      paramIndex += 1;
    }

    const updatedAt = input.updatedAt ?? this.clock.now().toISOString();
    updates.push(`updated_at = $${paramIndex}`);
    values.push(updatedAt);
    paramIndex += 1;

    values.push(id);

    try {
      const { rows } = await this.executor.query<WebhookSubscriptionRow>(
        `UPDATE ${this.tables.webhookSubscriptions}
         SET ${updates.join(", ")}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values,
      );

      if (rows.length === 0) {
        return err(createError("webhook.postgres.not_found", "Webhook subscription not found.", { id }));
      }

      return ok(toSubscriptionRecord(rows[0]));
    } catch (error) {
      return err(
        createError("webhook.postgres.update_failed", "Failed to update webhook subscription.", {
          id,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async getSubscription(id: string): Promise<Result<WebhookSubscriptionRecord | undefined, CatalystError>> {
    try {
      const { rows } = await this.executor.query<WebhookSubscriptionRow>(
        `SELECT * FROM ${this.tables.webhookSubscriptions} WHERE id = $1`,
        [id],
      );
      const record = rows[0] ? toSubscriptionRecord(rows[0]) : undefined;
      return ok(record);
    } catch (error) {
      return err(
        createError("webhook.postgres.read_failed", "Failed to load webhook subscription.", {
          id,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async listSubscriptions(
    options: ListWebhookSubscriptionsOptions = {},
  ): Promise<Result<ReadonlyArray<WebhookSubscriptionRecord>, CatalystError>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (options.orgId !== undefined) {
      if (options.orgId === null) {
        conditions.push(`org_id IS NULL`);
      } else {
        conditions.push(`org_id = $${paramIndex}`);
        values.push(options.orgId);
        paramIndex += 1;
      }
    }

    if (options.active !== undefined) {
      conditions.push(`active = $${paramIndex}`);
      values.push(options.active);
      paramIndex += 1;
    }

    if (options.eventType) {
      conditions.push(`$${paramIndex} = ANY(event_types)`);
      values.push(options.eventType);
      paramIndex += 1;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    try {
      const { rows } = await this.executor.query<WebhookSubscriptionRow>(
        `SELECT * FROM ${this.tables.webhookSubscriptions}
         ${where}
         ORDER BY created_at ASC, id ASC`,
        values,
      );
      return ok(rows.map((row) => toSubscriptionRecord(row)));
    } catch (error) {
      return err(
        createError("webhook.postgres.read_failed", "Failed to list webhook subscriptions.", {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async deleteSubscription(id: string): Promise<Result<void, CatalystError>> {
    try {
      await this.executor.query(`DELETE FROM ${this.tables.webhookSubscriptions} WHERE id = $1`, [id]);
      return ok(undefined);
    } catch (error) {
      return err(
        createError("webhook.postgres.delete_failed", "Failed to delete webhook subscription.", {
          id,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

class PostgresWebhookDeliveryStore implements WebhookDeliveryStorePort {
  private readonly tables: WebhookTables;
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly executor: QueryExecutor,
    options: PostgresWebhookStoreOptions = {},
  ) {
    this.tables = {
      webhookSubscriptions: options.tables?.webhookSubscriptions ?? "auth_webhook_subscriptions",
      webhookDeliveries: options.tables?.webhookDeliveries ?? "auth_webhook_deliveries",
    };
    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;
  }

  async createDelivery(
    input: CreateWebhookDeliveryInput,
  ): Promise<Result<WebhookDeliveryRecord, CatalystError>> {
    const id = input.id ?? this.idFactory();
    const createdAt = input.createdAt ?? this.clock.now().toISOString();
    const updatedAt = input.updatedAt ?? createdAt;

    try {
      const { rows } = await this.executor.query<WebhookDeliveryRow>(
        `INSERT INTO ${this.tables.webhookDeliveries} (
          id,
          subscription_id,
          event_id,
          status,
          attempt_count,
          last_attempt_at,
          next_attempt_at,
          payload,
          response,
          error_message,
          created_at,
          updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
        )
        RETURNING *`,
        [
          id,
          input.subscriptionId,
          input.eventId,
          input.status ?? "pending",
          input.attemptCount ?? 0,
          input.lastAttemptAt ?? null,
          input.nextAttemptAt ?? null,
          normalizePayload(input.payload),
          input.response ? normalizePayload(input.response) : null,
          input.errorMessage ?? null,
          createdAt,
          updatedAt,
        ],
      );

      return ok(toDeliveryRecord(rows[0]));
    } catch (error) {
      return err(
        createError("webhook.postgres.delivery_create_failed", "Failed to create webhook delivery.", {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async updateDelivery(
    id: string,
    input: UpdateWebhookDeliveryInput,
  ): Promise<Result<WebhookDeliveryRecord, CatalystError>> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex}`);
      values.push(input.status);
      paramIndex += 1;
    }

    if (input.attemptCount !== undefined) {
      updates.push(`attempt_count = $${paramIndex}`);
      values.push(input.attemptCount);
      paramIndex += 1;
    }

    if (input.lastAttemptAt !== undefined) {
      updates.push(`last_attempt_at = $${paramIndex}`);
      values.push(input.lastAttemptAt ?? null);
      paramIndex += 1;
    }

    if (input.nextAttemptAt !== undefined) {
      updates.push(`next_attempt_at = $${paramIndex}`);
      values.push(input.nextAttemptAt ?? null);
      paramIndex += 1;
    }

    if (input.response !== undefined) {
      updates.push(`response = $${paramIndex}`);
      values.push(input.response ? normalizePayload(input.response) : null);
      paramIndex += 1;
    }

    if (input.errorMessage !== undefined) {
      updates.push(`error_message = $${paramIndex}`);
      values.push(input.errorMessage ?? null);
      paramIndex += 1;
    }

    const updatedAt = input.updatedAt ?? this.clock.now().toISOString();
    updates.push(`updated_at = $${paramIndex}`);
    values.push(updatedAt);
    paramIndex += 1;

    values.push(id);

    try {
      const { rows } = await this.executor.query<WebhookDeliveryRow>(
        `UPDATE ${this.tables.webhookDeliveries}
         SET ${updates.join(", ")}
         WHERE id = $${paramIndex}
         RETURNING *`,
        values,
      );

      if (rows.length === 0) {
        return err(createError("webhook.postgres.delivery_not_found", "Webhook delivery not found.", { id }));
      }

      return ok(toDeliveryRecord(rows[0]));
    } catch (error) {
      return err(
        createError("webhook.postgres.delivery_update_failed", "Failed to update webhook delivery.", {
          id,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async getDelivery(id: string): Promise<Result<WebhookDeliveryRecord | undefined, CatalystError>> {
    try {
      const { rows } = await this.executor.query<WebhookDeliveryRow>(
        `SELECT * FROM ${this.tables.webhookDeliveries} WHERE id = $1`,
        [id],
      );
      const record = rows[0] ? toDeliveryRecord(rows[0]) : undefined;
      return ok(record);
    } catch (error) {
      return err(
        createError("webhook.postgres.delivery_read_failed", "Failed to load webhook delivery.", {
          id,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async listDeliveries(
    options: ListWebhookDeliveriesOptions = {},
  ): Promise<Result<ReadonlyArray<WebhookDeliveryRecord>, CatalystError>> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (options.subscriptionId) {
      conditions.push(`subscription_id = $${paramIndex}`);
      values.push(options.subscriptionId);
      paramIndex += 1;
    }

    if (options.eventId) {
      conditions.push(`event_id = $${paramIndex}`);
      values.push(options.eventId);
      paramIndex += 1;
    }

    if (options.status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(options.status);
      paramIndex += 1;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = options.limit ? `LIMIT ${options.limit}` : "";

    try {
      const { rows } = await this.executor.query<WebhookDeliveryRow>(
        `SELECT * FROM ${this.tables.webhookDeliveries}
         ${where}
         ORDER BY created_at ASC, id ASC
         ${limitClause}`,
        values,
      );
      return ok(rows.map((row) => toDeliveryRecord(row)));
    } catch (error) {
      return err(
        createError("webhook.postgres.delivery_read_failed", "Failed to list webhook deliveries.", {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async listPendingDeliveries(
    options: ListPendingDeliveriesOptions = {},
  ): Promise<Result<ReadonlyArray<WebhookDeliveryRecord>, CatalystError>> {
    const values: unknown[] = [];
    let paramIndex = 1;

    const conditions = [`status IN ('pending', 'delivering')`];

    if (options.before) {
      conditions.push(`(next_attempt_at IS NULL OR next_attempt_at <= $${paramIndex})`);
      values.push(options.before);
      paramIndex += 1;
    }

    const limitClause = options.limit ? `LIMIT ${options.limit}` : "";

    try {
      const { rows } = await this.executor.query<WebhookDeliveryRow>(
        `SELECT * FROM ${this.tables.webhookDeliveries}
         WHERE ${conditions.join(" AND ")}
         ORDER BY next_attempt_at ASC NULLS FIRST, created_at ASC
         ${limitClause}`,
        values,
      );
      return ok(rows.map((row) => toDeliveryRecord(row)));
    } catch (error) {
      return err(
        createError("webhook.postgres.delivery_read_failed", "Failed to list pending webhook deliveries.", {
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async deleteDelivery(id: string): Promise<Result<void, CatalystError>> {
    try {
      await this.executor.query(`DELETE FROM ${this.tables.webhookDeliveries} WHERE id = $1`, [id]);
      return ok(undefined);
    } catch (error) {
      return err(
        createError("webhook.postgres.delivery_delete_failed", "Failed to delete webhook delivery.", {
          id,
          cause: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

export const createPostgresWebhookSubscriptionStore = (
  executor: QueryExecutor,
  options?: PostgresWebhookStoreOptions,
): WebhookSubscriptionStorePort => new PostgresWebhookSubscriptionStore(executor, options);

export const createPostgresWebhookDeliveryStore = (
  executor: QueryExecutor,
  options?: PostgresWebhookStoreOptions,
): WebhookDeliveryStorePort => new PostgresWebhookDeliveryStore(executor, options);
