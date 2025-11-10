import {
  ok,
  type CatalystError,
  type Result,
  type WebhookDeliveryRecord,
  type WebhookDeliveryStatus,
} from "@catalyst-auth/contracts";
import { runWithSpan, type CatalystLogger } from "@catalyst-auth/telemetry";

import { defaultHttpClient } from "./default-http-client.js";
import { determineRetryDecision } from "./retry.js";
import { defaultSignatureGenerator } from "./signature.js";
import { clone, mergeHeaders } from "./utils.js";
import type {
  Clock,
  DeliveryAttemptContext,
  HttpClient,
  Logger,
  SignatureGenerator,
  WebhookStores,
  WorkerRunSummary,
} from "./types.js";
import {
  createWebhookWorkerTelemetry,
  type WebhookWorkerTelemetryContext,
  type WebhookWorkerTelemetryOptions,
} from "./telemetry.js";

export interface WorkerProcessResult {
  readonly status: WebhookDeliveryStatus;
  readonly record: WebhookDeliveryRecord;
  readonly nextAttemptAt?: string;
  readonly deadLetterUri?: string;
}

const defaultClock: Clock = {
  now: () => new Date(),
};

const SUCCESS_RANGE = { min: 200, max: 299 };

const isSuccessfulStatus = (status: number): boolean => status >= SUCCESS_RANGE.min && status <= SUCCESS_RANGE.max;

const buildRequestBody = (payload: Record<string, unknown>): string => JSON.stringify(payload);

const buildHeaders = (
  context: DeliveryAttemptContext,
  attemptNumber: number,
  signature: string,
): Record<string, string> => {
  const baseHeaders = mergeHeaders(context.subscription.headers, {
    "content-type": "application/json",
    "x-catalyst-event-id": context.delivery.eventId,
    "x-catalyst-subscription-id": context.delivery.subscriptionId,
    "x-catalyst-attempt": String(attemptNumber),
    "x-catalyst-signature": `sha256=${signature}`,
  });

  return baseHeaders;
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
};

export interface WebhookDeliveryWorkerOptions {
  readonly clock?: Clock;
  readonly httpClient?: HttpClient;
  readonly signatureGenerator?: SignatureGenerator;
  readonly logger?: Logger;
  readonly telemetry?: WebhookWorkerTelemetryOptions;
}

export interface WorkerRunOptions {
  readonly limit?: number;
  readonly before?: Date;
}

export class WebhookDeliveryWorker {
  private readonly clock: Clock;
  private readonly httpClient: HttpClient;
  private readonly signatureGenerator: SignatureGenerator;
  private readonly logger: Logger;
  private readonly telemetry: WebhookWorkerTelemetryContext;
  private readonly instrumentationLogger: CatalystLogger;

  constructor(private readonly stores: WebhookStores, options: WebhookDeliveryWorkerOptions = {}) {
    this.clock = options.clock ?? defaultClock;
    this.httpClient = options.httpClient ?? defaultHttpClient;
    this.signatureGenerator = options.signatureGenerator ?? defaultSignatureGenerator;
    const telemetry = createWebhookWorkerTelemetry(options.telemetry);
    this.telemetry = telemetry;
    this.instrumentationLogger = telemetry.logger;
    this.logger = options.logger ?? createLegacyLogger(telemetry.logger);
  }

  async runOnce(options: WorkerRunOptions = {}): Promise<Result<WorkerRunSummary, CatalystError>> {
    const start = performance.now();
    let outcome: "ok" | "error" = "ok";

    try {
      const result = await runWithSpan(
        this.telemetry.tracer,
        "webhook_worker.run_once",
        async (span) => {
          span.setAttribute("webhook.worker.limit", options.limit ?? 0);
          if (options.before) {
            span.setAttribute("webhook.worker.before", options.before.toISOString());
          }
          this.instrumentationLogger.debug("webhook.worker.run_once.start", {
            limit: options.limit,
            before: options.before?.toISOString(),
          });
          emitUserLog(this.logger, "debug", "webhook.worker.run_once.start", {
            limit: options.limit,
            before: options.before?.toISOString(),
          });

          const before = options.before ?? this.clock.now();
          const pendingResult = await this.stores.deliveries.listPendingDeliveries({
            before: before.toISOString(),
            limit: options.limit,
          });

          if (!pendingResult.ok) {
            outcome = "error";
            const errorContext = {
              error: describeCatalystError(pendingResult.error),
            } satisfies Record<string, unknown>;
            logCatalyst(this.instrumentationLogger, "error", "webhook.worker.run_once.list_failed", errorContext);
            emitUserLog(this.logger, "error", "webhook.worker.run_once.list_failed", errorContext);
            return pendingResult;
          }

          let succeeded = 0;
          let retried = 0;
          let deadLettered = 0;

          for (const delivery of pendingResult.value) {
            const processResult = await this.processDeliveryRecord(delivery);
            if (!processResult.ok) {
              outcome = "error";
              const errorContext = {
                deliveryId: delivery.id,
                error: describeCatalystError(processResult.error),
              } satisfies Record<string, unknown>;
              logCatalyst(this.instrumentationLogger, "error", "webhook.worker.delivery_failed", errorContext);
              emitUserLog(this.logger, "error", "webhook.worker.delivery_failed", errorContext);
              return processResult;
            }

            this.recordDeliveryOutcome(processResult.value, delivery.id);
            succeeded += processResult.value.status === "succeeded" ? 1 : 0;
            retried += processResult.value.status === "pending" ? 1 : 0;
            deadLettered += processResult.value.status === "dead_lettered" ? 1 : 0;
          }

          const summary = {
            total: pendingResult.value.length,
            succeeded,
            retried,
            deadLettered,
          } satisfies WorkerRunSummary;

          this.instrumentationLogger.info("webhook.worker.run_once.completed", summary);
          emitUserLog(this.logger, "info", "webhook.worker.run_once.completed", summary);
          return ok(summary);
        },
        {
          onError: (error) => {
            outcome = "error";
            const message = error instanceof Error ? error.message : String(error);
            this.instrumentationLogger.error("webhook.worker.run_once.failed", { error: message });
            emitUserLog(this.logger, "error", "webhook.worker.run_once.failed", { error: message });
          },
        },
      );

      if (!result.ok) {
        outcome = "error";
      }

      return result;
    } finally {
      const duration = performance.now() - start;
      this.telemetry.metrics.runCounter.add(1, { outcome });
      this.telemetry.metrics.runDuration.record(duration, { outcome });
    }
  }

  async processDeliveryById(
    id: string,
  ): Promise<Result<WorkerProcessResult | { readonly status: "not_found" }, CatalystError>> {
    const deliveryResult = await this.stores.deliveries.getDelivery(id);
    if (!deliveryResult.ok) {
      return deliveryResult;
    }

    const record = deliveryResult.value;
    if (!record) {
      logCatalyst(this.instrumentationLogger, "warn", "webhook.worker.delivery_missing", { deliveryId: id });
      emitUserLog(this.logger, "warn", "webhook.worker.delivery_missing", { deliveryId: id });
      return ok({ status: "not_found" } as const);
    }

    const result = await this.processDeliveryRecord(record);
    if (result.ok) {
      this.recordDeliveryOutcome(result.value, record.id);
    }
    return result;
  }

  private async processDeliveryRecord(
    delivery: WebhookDeliveryRecord,
  ): Promise<Result<WorkerProcessResult, CatalystError>> {
    const subscriptionResult = await this.stores.subscriptions.getSubscription(delivery.subscriptionId);
    if (!subscriptionResult.ok) {
      return subscriptionResult;
    }

    const subscription = subscriptionResult.value;
    if (!subscription) {
      const updateResult = await this.stores.deliveries.updateDelivery(delivery.id, {
        status: "dead_lettered",
        nextAttemptAt: null,
        errorMessage: "Webhook subscription not found.",
        updatedAt: this.clock.now().toISOString(),
      });
      if (!updateResult.ok) {
        return updateResult;
      }

      return ok({ status: updateResult.value.status, record: updateResult.value });
    }

    return this.attemptDelivery({ delivery, subscription });
  }

  private recordDeliveryOutcome(result: WorkerProcessResult, deliveryId: string): void {
    const message = DELIVERY_STATUS_MESSAGES[result.status] ?? DEFAULT_DELIVERY_MESSAGE;
    const level = DELIVERY_STATUS_LOG_LEVEL[result.status] ?? "info";
    const context = {
      deliveryId,
      subscriptionId: result.record.subscriptionId,
      status: result.status,
      attemptCount: result.record.attemptCount,
      nextAttemptAt: result.nextAttemptAt,
      deadLetterUri: result.deadLetterUri,
      errorMessage: result.record.errorMessage ?? undefined,
    } satisfies Record<string, unknown>;

    this.telemetry.metrics.deliveryCounter.add(1, { status: result.status });
    logCatalyst(this.instrumentationLogger, level, message, context);
    emitUserLog(this.logger, level, message, context);
  }

  private async attemptDelivery(
    context: DeliveryAttemptContext,
  ): Promise<Result<WorkerProcessResult, CatalystError>> {
    const attemptNumber = context.delivery.attemptCount + 1;
    const startedAt = this.clock.now().toISOString();

    const markDelivering = await this.stores.deliveries.updateDelivery(context.delivery.id, {
      status: "delivering",
      attemptCount: attemptNumber,
      lastAttemptAt: startedAt,
      nextAttemptAt: null,
      updatedAt: startedAt,
      errorMessage: null,
    });

    if (!markDelivering.ok) {
      return markDelivering;
    }

    const body = buildRequestBody(context.delivery.payload);
    const signature = this.signatureGenerator.sign(body, context.subscription.secret);
    const headers = buildHeaders(context, attemptNumber, signature);

    try {
      const response = await this.httpClient.execute({
        url: context.subscription.targetUrl,
        method: "POST",
        headers,
        body,
      });

      if (isSuccessfulStatus(response.status)) {
        const completedAt = this.clock.now().toISOString();
        const updateResult = await this.stores.deliveries.updateDelivery(context.delivery.id, {
          status: "succeeded",
          attemptCount: attemptNumber,
          nextAttemptAt: null,
          response: {
            status: response.status,
            headers: clone(response.headers),
            body: response.body,
          },
          errorMessage: null,
          updatedAt: completedAt,
        });

        if (!updateResult.ok) {
          return updateResult;
        }

        return ok({ status: "succeeded", record: updateResult.value });
      }

      return this.handleFailure(context, attemptNumber, response);
    } catch (error) {
      return this.handleFailure(context, attemptNumber, undefined, error);
    }
  }

  private async handleFailure(
    context: DeliveryAttemptContext,
    attemptNumber: number,
    response?: { status: number; headers: Record<string, string>; body?: string },
    thrown?: unknown,
  ): Promise<Result<WorkerProcessResult, CatalystError>> {
    const failureMessage = response
      ? `HTTP ${response.status}`
      : thrown
        ? formatError(thrown)
        : "Unknown delivery failure";

    const decision = determineRetryDecision(attemptNumber, context.subscription.retryPolicy, this.clock);
    const updatedAt = this.clock.now().toISOString();

    const updateResult = await this.stores.deliveries.updateDelivery(context.delivery.id, {
      status: decision.shouldRetry ? "pending" : "dead_lettered",
      attemptCount: attemptNumber,
      nextAttemptAt: decision.shouldRetry ? decision.nextAttemptAt ?? null : null,
      response: response
        ? {
            status: response.status,
            headers: clone(response.headers),
            body: response.body,
          }
        : undefined,
      errorMessage: failureMessage,
      updatedAt,
    });

    if (!updateResult.ok) {
      return updateResult;
    }

    if (decision.shouldRetry) {
      return ok({
        status: "pending",
        record: updateResult.value,
        nextAttemptAt: decision.nextAttemptAt,
      });
    }

    return ok({
      status: "dead_lettered",
      record: updateResult.value,
      deadLetterUri: decision.deadLetterUri,
    });
  }
}

const DEFAULT_DELIVERY_MESSAGE = "webhook.worker.delivery_processed";

const DELIVERY_STATUS_MESSAGES: Record<WebhookDeliveryStatus, string> = {
  pending: "webhook.worker.delivery_retry_scheduled",
  delivering: "webhook.worker.delivery_inflight",
  succeeded: "webhook.worker.delivery_succeeded",
  failed: "webhook.worker.delivery_failed",
  dead_lettered: "webhook.worker.delivery_dead_lettered",
};

type LoggerLevel = "debug" | "info" | "warn" | "error";

const DELIVERY_STATUS_LOG_LEVEL: Record<WebhookDeliveryStatus, LoggerLevel> = {
  pending: "warn",
  delivering: "info",
  succeeded: "info",
  failed: "error",
  dead_lettered: "error",
};

const describeCatalystError = (error: CatalystError): string => {
  if (typeof error === "object" && error !== null) {
    const typed = error as { code?: string; message?: string };
    if (typed.message) {
      return typed.message;
    }
    if (typed.code) {
      return typed.code;
    }
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const emitUserLog = (
  logger: Logger | undefined,
  level: LoggerLevel,
  message: string,
  context?: Record<string, unknown>,
): void => {
  const fn = logger?.[level];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
  }
};

const logCatalyst = (
  logger: CatalystLogger,
  level: LoggerLevel,
  message: string,
  context?: Record<string, unknown>,
): void => {
  if (level === "debug") {
    logger.debug(message, context);
  } else if (level === "info") {
    logger.info(message, context);
  } else if (level === "warn") {
    logger.warn(message, context);
  } else {
    logger.error(message, context);
  }
};

const createLegacyLogger = (logger: CatalystLogger): Logger => ({
  debug(message, context) {
    logger.debug(message, context);
  },
  info(message, context) {
    logger.info(message, context);
  },
  warn(message, context) {
    logger.warn(message, context);
  },
  error(message, context) {
    logger.error(message, context);
  },
});
