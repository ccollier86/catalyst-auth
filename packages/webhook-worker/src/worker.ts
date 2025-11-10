import {
  ok,
  type CatalystError,
  type Result,
  type WebhookDeliveryRecord,
  type WebhookDeliveryStatus,
} from "@catalyst-auth/contracts";

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
}

export interface WorkerRunOptions {
  readonly limit?: number;
  readonly before?: Date;
}

export class WebhookDeliveryWorker {
  private readonly clock: Clock;
  private readonly httpClient: HttpClient;
  private readonly signatureGenerator: SignatureGenerator;
  private readonly logger?: Logger;

  constructor(private readonly stores: WebhookStores, options: WebhookDeliveryWorkerOptions = {}) {
    this.clock = options.clock ?? defaultClock;
    this.httpClient = options.httpClient ?? defaultHttpClient;
    this.signatureGenerator = options.signatureGenerator ?? defaultSignatureGenerator;
    this.logger = options.logger;
  }

  async runOnce(options: WorkerRunOptions = {}): Promise<Result<WorkerRunSummary, CatalystError>> {
    const before = options.before ?? this.clock.now();
    const pendingResult = await this.stores.deliveries.listPendingDeliveries({
      before: before.toISOString(),
      limit: options.limit,
    });

    if (!pendingResult.ok) {
      return pendingResult;
    }

    let succeeded = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const delivery of pendingResult.value) {
      const processResult = await this.processDeliveryRecord(delivery);
      if (!processResult.ok) {
        return processResult;
      }

      succeeded += processResult.value.status === "succeeded" ? 1 : 0;
      retried += processResult.value.status === "pending" ? 1 : 0;
      deadLettered += processResult.value.status === "dead_lettered" ? 1 : 0;
    }

    return ok({
      total: pendingResult.value.length,
      succeeded,
      retried,
      deadLettered,
    });
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
      this.logger?.warn?.("webhook.worker.delivery_missing", { deliveryId: id });
      return ok({ status: "not_found" } as const);
    }

    return this.processDeliveryRecord(record);
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

        this.logger?.info?.("webhook.worker.delivery_succeeded", {
          deliveryId: updateResult.value.id,
          subscriptionId: context.subscription.id,
          status: response.status,
        });

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
      this.logger?.warn?.("webhook.worker.delivery_retry_scheduled", {
        deliveryId: updateResult.value.id,
        subscriptionId: context.subscription.id,
        attemptNumber,
        nextAttemptAt: decision.nextAttemptAt,
        failureMessage,
      });
      return ok({
        status: "pending",
        record: updateResult.value,
        nextAttemptAt: decision.nextAttemptAt,
      });
    }

    this.logger?.error?.("webhook.worker.delivery_dead_lettered", {
      deliveryId: updateResult.value.id,
      subscriptionId: context.subscription.id,
      attemptNumber,
      deadLetterUri: decision.deadLetterUri,
      failureMessage,
    });

    return ok({
      status: "dead_lettered",
      record: updateResult.value,
      deadLetterUri: decision.deadLetterUri,
    });
  }
}
