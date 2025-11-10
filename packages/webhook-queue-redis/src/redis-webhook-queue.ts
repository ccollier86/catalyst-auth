import { randomUUID } from "node:crypto";

import {
  Queue,
  QueueScheduler,
  Worker,
  type ConnectionOptions,
  type JobsOptions,
  type WorkerOptions,
} from "bullmq";

import {
  err,
  ok,
  type CatalystError,
  type Result,
  type WebhookQueueDeadLetterOptions,
  type WebhookQueueEnqueueOptions,
  type WebhookQueueMessage,
  type WebhookQueueMessageHandle,
  type WebhookQueuePort,
  type WebhookQueueRetryOptions,
  type WebhookQueueSubscription,
} from "@catalyst-auth/contracts";

interface RedisWebhookQueueJobData {
  readonly deliveryId: string;
  readonly attempt: number;
  readonly enqueuedAt: string;
  readonly metadata?: Record<string, unknown>;
}

interface RedisWebhookQueueDeadLetterData extends RedisWebhookQueueJobData {
  readonly reason: string;
  readonly attempts: number;
  readonly deadLetterUri?: string;
}

export interface RedisWebhookQueueConfig {
  readonly queueName: string;
  readonly deadLetterQueueName: string;
  readonly prefix?: string;
}

export interface RedisWebhookQueueTelemetry {
  enqueue?(payload: { deliveryId: string; attempt: number; delaySeconds: number }): void;
  ack?(payload: { deliveryId: string; attempt: number }): void;
  retry?(payload: {
    deliveryId: string;
    attempt: number;
    nextAttempt: number;
    delaySeconds: number;
  }): void;
  deadLetter?(payload: {
    deliveryId: string;
    attempt: number;
    attempts: number;
    reason: string;
    deadLetterUri?: string;
  }): void;
  error?(error: CatalystError, context: Record<string, unknown>): void;
}

export interface RedisWebhookQueueOptions {
  readonly connection?: ConnectionOptions;
  readonly config?: Partial<RedisWebhookQueueConfig>;
  readonly telemetry?: RedisWebhookQueueTelemetry;
  readonly defaultJobOptions?: JobsOptions;
}

export interface RedisWebhookQueue extends WebhookQueuePort {
  readonly config: RedisWebhookQueueConfig;
  close(): Promise<void>;
}

const createError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retryable = true,
): CatalystError => ({
  code,
  message,
  details,
  retryable,
});

const defaultJobOptions: JobsOptions = {
  removeOnComplete: true,
  removeOnFail: false,
};

const toDelayMilliseconds = (delaySeconds: number | undefined): number => {
  if (!delaySeconds || !Number.isFinite(delaySeconds)) {
    return 0;
  }
  return Math.max(0, Math.round(delaySeconds * 1000));
};

const nowIso = (): string => new Date().toISOString();

export const createRedisWebhookQueue = (
  options: RedisWebhookQueueOptions = {},
): RedisWebhookQueue => {
  const config: RedisWebhookQueueConfig = {
    queueName: options.config?.queueName ?? "webhook-deliveries",
    deadLetterQueueName: options.config?.deadLetterQueueName ?? "webhook-deliveries-dlq",
    prefix: options.config?.prefix,
  };

  const telemetry: RedisWebhookQueueTelemetry = options.telemetry ?? {};

  const queue = new Queue<RedisWebhookQueueJobData>(config.queueName, {
    connection: options.connection,
    prefix: config.prefix,
    defaultJobOptions: {
      ...defaultJobOptions,
      ...options.defaultJobOptions,
    },
  });

  const deadLetterQueue = new Queue<RedisWebhookQueueDeadLetterData>(config.deadLetterQueueName, {
    connection: options.connection,
    prefix: config.prefix,
    defaultJobOptions: defaultJobOptions,
  });

  const scheduler = new QueueScheduler(config.queueName, {
    connection: options.connection,
    prefix: config.prefix,
  });
  void scheduler.waitUntilReady().catch(() => undefined);

  let worker: Worker<RedisWebhookQueueJobData> | undefined;

  const enqueue: WebhookQueuePort["enqueue"] = async (delivery, enqueueOptions) => {
    const attempt = delivery.attempt ?? 1;
    const jobData: RedisWebhookQueueJobData = {
      deliveryId: delivery.deliveryId,
      attempt,
      enqueuedAt: nowIso(),
      metadata: enqueueOptions?.metadata,
    };

    const delay = toDelayMilliseconds(enqueueOptions?.delaySeconds);

    try {
      await queue.add("webhook-delivery", jobData, {
        delay,
        jobId: `${delivery.deliveryId}:${attempt}:${randomUUID()}`,
      });
      telemetry.enqueue?.({ deliveryId: delivery.deliveryId, attempt, delaySeconds: delay / 1000 });
      return ok(undefined);
    } catch (error) {
      const enqueueError = createError("webhook.queue.redis.enqueue_failed", "Failed to enqueue webhook delivery.", {
        deliveryId: delivery.deliveryId,
        attempt,
        cause: error instanceof Error ? error.message : String(error),
      });
      telemetry.error?.(enqueueError, { operation: "enqueue" });
      return err(enqueueError);
    }
  };

  const consume: WebhookQueuePort["consume"] = async (handler, consumerOptions) => {
    if (worker) {
      return err(
        createError("webhook.queue.redis.already_consuming", "A consumer is already registered for this queue.", {
          queue: config.queueName,
        }),
      );
    }

    const workerOptions: WorkerOptions = {
      connection: options.connection,
      concurrency: consumerOptions?.concurrency ?? 1,
      lockDuration: toDelayMilliseconds(consumerOptions?.visibilityTimeoutSeconds ?? 30),
      autorun: true,
    };

    worker = new Worker<RedisWebhookQueueJobData>(
      config.queueName,
      async (job) =>
        new Promise<void>((resolve, reject) => {
          let settled = false;

          const finish = async (
            action: () => Promise<void>,
            onSuccess?: () => void,
          ): Promise<Result<void, CatalystError>> => {
            if (settled) {
              return ok(undefined);
            }
            settled = true;
            try {
              await action();
              onSuccess?.();
              resolve();
              return ok(undefined);
            } catch (error) {
              const failure = createError(
                "webhook.queue.redis.consumer_failed",
                "Queue consumer failed to settle job.",
                {
                  queue: config.queueName,
                  jobId: job.id,
                  deliveryId: job.data.deliveryId,
                  cause: error instanceof Error ? error.message : String(error),
                },
              );
              telemetry.error?.(failure, { operation: "settle", jobId: job.id ?? undefined });
              reject(error instanceof Error ? error : new Error(String(error)));
              return err(failure);
            }
          };

          const message: WebhookQueueMessage = {
            id: String(job.id ?? job.name ?? randomUUID()),
            deliveryId: job.data.deliveryId,
            attempt: job.data.attempt,
            enqueuedAt: job.data.enqueuedAt,
            metadata: job.data.metadata,
          };

          const handle: WebhookQueueMessageHandle = {
            message,
            ack: () =>
              finish(async () => undefined, () => {
                telemetry.ack?.({ deliveryId: message.deliveryId, attempt: message.attempt });
              }),
            retry: (retryOptions) =>
              finish(async () => {
                const retryData: RedisWebhookQueueJobData = {
                  deliveryId: job.data.deliveryId,
                  attempt: retryOptions.nextAttempt,
                  enqueuedAt: nowIso(),
                  metadata: {
                    ...job.data.metadata,
                    ...retryOptions.metadata,
                  },
                };
                await queue.add("webhook-delivery", retryData, {
                  delay: toDelayMilliseconds(retryOptions.delaySeconds),
                  jobId: `${job.data.deliveryId}:${retryOptions.nextAttempt}:${randomUUID()}`,
                });
              }, () => {
                telemetry.retry?.({
                  deliveryId: message.deliveryId,
                  attempt: message.attempt,
                  nextAttempt: retryOptions.nextAttempt,
                  delaySeconds: retryOptions.delaySeconds,
                });
              }),
            deadLetter: (deadLetterOptions) =>
              finish(async () => {
                const payload: RedisWebhookQueueDeadLetterData = {
                  deliveryId: job.data.deliveryId,
                  attempt: job.data.attempt,
                  enqueuedAt: job.data.enqueuedAt,
                  metadata: {
                    ...job.data.metadata,
                    ...deadLetterOptions.metadata,
                  },
                  reason: deadLetterOptions.reason,
                  attempts: deadLetterOptions.attempts,
                  deadLetterUri: deadLetterOptions.deadLetterUri,
                };
                await deadLetterQueue.add("webhook-delivery-dead-letter", payload, {
                  jobId: `${job.data.deliveryId}:dlq:${randomUUID()}`,
                });
              }, () => {
                telemetry.deadLetter?.({
                  deliveryId: message.deliveryId,
                  attempt: message.attempt,
                  attempts: deadLetterOptions.attempts,
                  reason: deadLetterOptions.reason,
                  deadLetterUri: deadLetterOptions.deadLetterUri,
                });
              }),
          };

          handler(handle).catch((error) => {
            if (settled) {
              return;
            }
            settled = true;
            const failure = createError(
              "webhook.queue.redis.handler_failed",
              "Unhandled error in queue consumer handler.",
              {
                queue: config.queueName,
                jobId: job.id,
                deliveryId: job.data.deliveryId,
                cause: error instanceof Error ? error.message : String(error),
              },
              true,
            );
            telemetry.error?.(failure, { operation: "handler", jobId: job.id ?? undefined });
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        }),
      workerOptions,
    );

    worker.on("error", (error) => {
      const failure = createError(
        "webhook.queue.redis.worker_error",
        "Queue worker emitted an error.",
        {
          queue: config.queueName,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
      telemetry.error?.(failure, { operation: "worker" });
    });

    return ok({
      close: async () => {
        if (worker) {
          const current = worker;
          worker = undefined;
          await current.close();
        }
      },
    } satisfies WebhookQueueSubscription);
  };

  const close = async (): Promise<void> => {
    if (worker) {
      const current = worker;
      worker = undefined;
      await current.close();
    }
    await scheduler.close();
    await queue.close();
    await deadLetterQueue.close();
  };

  return {
    config,
    enqueue,
    consume,
    close,
  } satisfies RedisWebhookQueue;
};
