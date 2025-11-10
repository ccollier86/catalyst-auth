import {
  err,
  ok,
  type CatalystError,
  type Result,
  type WebhookQueueConsumerOptions,
  type WebhookQueueMessageHandle,
  type WebhookQueuePort,
  type WebhookQueueSubscription,
} from "@catalyst-auth/contracts";

import type { Clock, Logger, WebhookStores } from "./types.js";
import type { WebhookDeliveryWorkerOptions } from "./worker.js";
import { WebhookDeliveryWorker, type WorkerProcessResult } from "./worker.js";

const DEFAULT_ERROR_RETRY_DELAY_SECONDS = 60;

const defaultClock: Clock = {
  now: () => new Date(),
};

const computeDelaySeconds = (nextAttemptAt: string | undefined, clock: Clock): number => {
  if (!nextAttemptAt) {
    return 0;
  }
  const nextTime = new Date(nextAttemptAt).getTime();
  if (Number.isNaN(nextTime)) {
    return 0;
  }
  const now = clock.now().getTime();
  const diffMs = nextTime - now;
  if (diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / 1000);
};

const handleQueueResult = (
  logger: Logger | undefined,
  message: string,
  result: Result<void, CatalystError>,
  context: Record<string, unknown>,
) => {
  if (!result.ok) {
    logger?.error?.(message, { ...context, error: result.error });
  }
};

const ensureSettlement = async (
  action: () => Promise<Result<void, CatalystError>>,
): Promise<Result<void, CatalystError>> => {
  try {
    return await action();
  } catch (error) {
    return err({
      code: "webhook.queue.worker.unexpected_error",
      message: "Unexpected error while settling queue message.",
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
      retryable: true,
    });
  }
};

export interface WebhookQueueWorkerOptions extends WebhookDeliveryWorkerOptions {
  readonly logger?: Logger;
  readonly consumer?: WebhookQueueConsumerOptions;
  readonly errorRetryDelaySeconds?: number;
}

export interface WebhookQueueWorkerStartOptions {
  readonly consumer?: WebhookQueueConsumerOptions;
}

export interface WebhookQueueWorkerController {
  start(options?: WebhookQueueWorkerStartOptions): Promise<Result<void, CatalystError>>;
  stop(): Promise<void>;
}

const isNotFoundResult = (
  result: WorkerProcessResult | { readonly status: "not_found" },
): result is { readonly status: "not_found" } => result.status === "not_found";

export const createWebhookQueueWorker = (
  queue: WebhookQueuePort,
  stores: WebhookStores,
  options: WebhookQueueWorkerOptions = {},
): WebhookQueueWorkerController => {
  const clock = options.clock ?? defaultClock;
  const logger = options.logger;
  const worker = new WebhookDeliveryWorker(stores, { ...options, clock });

  let subscription: WebhookQueueSubscription | undefined;
  let started = false;

  const retryOnErrorDelay = Math.max(0, options.errorRetryDelaySeconds ?? DEFAULT_ERROR_RETRY_DELAY_SECONDS);

  const handleMessage = async (handle: WebhookQueueMessageHandle): Promise<void> => {
    const deliveryId = handle.message.deliveryId;

    const processResult = await worker.processDeliveryById(deliveryId);
    if (!processResult.ok) {
      logger?.error?.("webhook.queue.worker.processing_failed", {
        deliveryId,
        error: processResult.error,
      });
      const retryResult = await ensureSettlement(() =>
        handle.retry({
          delaySeconds: retryOnErrorDelay,
          nextAttempt: (handle.message.attempt ?? 0) + 1,
          metadata: { reason: "processing_error" },
        }),
      );
      handleQueueResult(logger, "webhook.queue.worker.retry_failed", retryResult, {
        deliveryId,
        attempt: handle.message.attempt,
      });
      return;
    }

    if (isNotFoundResult(processResult.value)) {
      const ackResult = await ensureSettlement(() => handle.ack());
      handleQueueResult(logger, "webhook.queue.worker.ack_failed", ackResult, {
        deliveryId,
        status: "not_found",
      });
      return;
    }

    const outcome = processResult.value;

    if (outcome.status === "succeeded") {
      const ackResult = await ensureSettlement(() => handle.ack());
      handleQueueResult(logger, "webhook.queue.worker.ack_failed", ackResult, {
        deliveryId,
        status: outcome.status,
      });
      return;
    }

    if (outcome.status === "pending") {
      const nextAttempt = outcome.record.attemptCount + 1;
      const retryDelay = computeDelaySeconds(outcome.nextAttemptAt ?? outcome.record.nextAttemptAt, clock);
      const retryResult = await ensureSettlement(() =>
        handle.retry({
          delaySeconds: retryDelay,
          nextAttempt,
          metadata: { deliveryId },
        }),
      );
      handleQueueResult(logger, "webhook.queue.worker.retry_failed", retryResult, {
        deliveryId,
        status: outcome.status,
        nextAttempt,
        retryDelay,
      });
      return;
    }

    const deadLetterResult = await ensureSettlement(() =>
      handle.deadLetter({
        reason: outcome.record.errorMessage ?? "Delivery moved to dead-letter queue.",
        attempts: outcome.record.attemptCount,
        deadLetterUri: outcome.deadLetterUri,
        metadata: { deliveryId },
      }),
    );
    handleQueueResult(logger, "webhook.queue.worker.dead_letter_failed", deadLetterResult, {
      deliveryId,
      status: outcome.status,
    });
  };

  return {
    async start(startOptions?: WebhookQueueWorkerStartOptions): Promise<Result<void, CatalystError>> {
      if (started) {
        logger?.warn?.("webhook.queue.worker.already_started");
        return ok(undefined);
      }

      const consumerOptions = startOptions?.consumer ?? options.consumer;
      const consumeResult = await queue.consume(handleMessage, consumerOptions);
      if (!consumeResult.ok) {
        return consumeResult;
      }

      subscription = consumeResult.value;
      started = true;
      logger?.info?.("webhook.queue.worker.started", {
        concurrency: consumerOptions?.concurrency ?? undefined,
      });
      return ok(undefined);
    },
    async stop(): Promise<void> {
      if (!started) {
        return;
      }
      started = false;
      const current = subscription;
      subscription = undefined;
      if (current) {
        await current.close();
      }
      logger?.info?.("webhook.queue.worker.stopped");
    },
  };
};
