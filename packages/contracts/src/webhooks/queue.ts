import type { CatalystError } from "../types/domain-error.js";
import type { Result } from "../types/result.js";

export interface WebhookQueueDelivery {
  readonly deliveryId: string;
  readonly attempt?: number;
}

export interface WebhookQueueMessage extends WebhookQueueDelivery {
  readonly id: string;
  readonly attempt: number;
  readonly enqueuedAt: string;
  readonly metadata?: Record<string, unknown>;
}

export interface WebhookQueueEnqueueOptions {
  readonly delaySeconds?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface WebhookQueueRetryOptions {
  readonly delaySeconds: number;
  readonly nextAttempt: number;
  readonly metadata?: Record<string, unknown>;
}

export interface WebhookQueueDeadLetterOptions {
  readonly reason: string;
  readonly attempts: number;
  readonly deadLetterUri?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface WebhookQueueMessageHandle {
  readonly message: WebhookQueueMessage;
  ack(): Promise<Result<void, CatalystError>>;
  retry(options: WebhookQueueRetryOptions): Promise<Result<void, CatalystError>>;
  deadLetter(options: WebhookQueueDeadLetterOptions): Promise<Result<void, CatalystError>>;
}

export interface WebhookQueueConsumerOptions {
  readonly concurrency?: number;
  readonly visibilityTimeoutSeconds?: number;
}

export interface WebhookQueueSubscription {
  close(): Promise<void>;
}

export interface WebhookQueuePort {
  enqueue(
    delivery: WebhookQueueDelivery,
    options?: WebhookQueueEnqueueOptions,
  ): Promise<Result<void, CatalystError>>;
  consume(
    handler: (handle: WebhookQueueMessageHandle) => Promise<void>,
    options?: WebhookQueueConsumerOptions,
  ): Promise<Result<WebhookQueueSubscription, CatalystError>>;
}
