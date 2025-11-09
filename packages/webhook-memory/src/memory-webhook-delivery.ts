import { createHmac } from "node:crypto";

import type {
  DeliveryResult,
  WebhookDeliveryPort,
  WebhookEndpoint,
  WebhookEventPayload,
  WebhookRetryPolicy,
} from "@catalyst-auth/contracts";
import { err, ok } from "@catalyst-auth/contracts";
import type { InfraError } from "@catalyst-auth/contracts";

interface Clock {
  now(): Date;
}

interface HttpRequest {
  readonly url: string;
  readonly body: string;
  readonly headers: Record<string, string>;
}

interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly bodyText?: string;
}

export interface RetryQueueItem {
  readonly event: WebhookEventPayload;
  readonly endpoint: WebhookEndpoint;
  readonly attempt: number;
  readonly scheduledFor: string;
}

export interface DeadLetterItem {
  readonly event: WebhookEventPayload;
  readonly endpoint: WebhookEndpoint;
  readonly attempts: number;
  readonly reason: string;
}

export interface MemoryWebhookDeliveryOptions {
  readonly clock?: Clock;
  readonly httpClient?: (request: HttpRequest) => Promise<HttpResponse>;
  readonly userAgent?: string;
}

const DEFAULT_USER_AGENT = "catalyst-webhook-memory/0.1.0";

const defaultClock: Clock = {
  now: () => new Date(),
};

const defaultHttpClient = async (request: HttpRequest): Promise<HttpResponse> => {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });

  const bodyText = await response.text().catch(() => undefined);

  return {
    status: response.status,
    ok: response.ok,
    bodyText,
  };
};

const isRetryableStatus = (status: number): boolean => status >= 500 || status === 429;

const createSignatureHeader = (secret: string, timestamp: string, body: string): string => {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

const nextDelaySeconds = (policy: WebhookRetryPolicy, attempt: number): number | null => {
  if (policy.backoffSeconds.length === 0) {
    return null;
  }

  const index = Math.max(0, Math.min(policy.backoffSeconds.length - 1, attempt - 2));
  return policy.backoffSeconds[index] ?? null;
};

export interface MemoryWebhookDelivery extends WebhookDeliveryPort {
  readonly peekRetryQueue: () => ReadonlyArray<RetryQueueItem>;
  readonly shiftRetryQueue: () => RetryQueueItem | undefined;
  readonly peekDeadLetters: () => ReadonlyArray<DeadLetterItem>;
  readonly clearQueues: () => void;
}

export const createMemoryWebhookDelivery = (
  options: MemoryWebhookDeliveryOptions = {},
): MemoryWebhookDelivery => {
  const clock = options.clock ?? defaultClock;
  const httpClient = options.httpClient ?? defaultHttpClient;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  const retryQueue: RetryQueueItem[] = [];
  const deadLetters: DeadLetterItem[] = [];

  const deliver: WebhookDeliveryPort["deliver"] = async (
    event: WebhookEventPayload,
    endpoint: WebhookEndpoint,
  ) => {
    const timestamp = clock.now().toISOString();
    const body = JSON.stringify(event);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": userAgent,
      "x-catalyst-delivery-id": event.id,
      "x-catalyst-event-type": event.type,
      "x-catalyst-sent-at": timestamp,
      ...endpoint.headers,
    };

    if (endpoint.secret) {
      headers["x-catalyst-signature"] = createSignatureHeader(endpoint.secret, timestamp, body);
    }

    let response: HttpResponse;

    try {
      response = await httpClient({
        url: endpoint.url,
        body,
        headers,
      });
    } catch (cause) {
      const error: InfraError = {
        code: "webhook.delivery_failed",
        message: "Webhook delivery failed due to network error.",
        retryable: true,
        details: {
          endpointId: endpoint.id,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      };

      return err(error);
    }

    const nextAttemptAt = !response.ok && endpoint.retryPolicy
      ? (() => {
          const delay = nextDelaySeconds(endpoint.retryPolicy, 2);
          if (delay === null) {
            return undefined;
          }
          const scheduled = new Date(clock.now().getTime() + delay * 1000);
          return scheduled.toISOString();
        })()
      : undefined;

    const result: DeliveryResult = {
      attempt: 1,
      delivered: response.ok,
      statusCode: response.status,
      errorMessage: response.ok ? undefined : response.bodyText ?? "Delivery failed with non-success status.",
      nextAttemptAt,
    };

    if (!response.ok && isRetryableStatus(response.status)) {
      const retryableError: InfraError = {
        code: "webhook.delivery_not_ok",
        message: "Received non-success response from webhook endpoint.",
        retryable: true,
        details: {
          endpointId: endpoint.id,
          status: response.status,
          body: response.bodyText,
        },
      };
      return err(retryableError);
    }

    return ok(result);
  };

  const scheduleRetry: WebhookDeliveryPort["scheduleRetry"] = async (
    event: WebhookEventPayload,
    endpoint: WebhookEndpoint,
    previous: DeliveryResult,
  ) => {
    const policy = endpoint.retryPolicy;
    if (!policy) {
      return;
    }

    const nextAttempt = previous.attempt + 1;
    const maxAttempts = Math.max(1, policy.maxAttempts);

    if (nextAttempt > maxAttempts) {
      deadLetters.push({
        event,
        endpoint,
        attempts: previous.attempt,
        reason: "Max attempts exceeded.",
      });
      return;
    }

    const delaySeconds = nextDelaySeconds(policy, nextAttempt);
    const scheduledFor = delaySeconds === null ? clock.now() : new Date(clock.now().getTime() + delaySeconds * 1000);

    retryQueue.push({
      event,
      endpoint,
      attempt: nextAttempt,
      scheduledFor: scheduledFor.toISOString(),
    });
  };

  return {
    deliver,
    scheduleRetry,
    peekRetryQueue: () => retryQueue.slice(),
    shiftRetryQueue: () => retryQueue.shift(),
    peekDeadLetters: () => deadLetters.slice(),
    clearQueues: () => {
      retryQueue.splice(0, retryQueue.length);
      deadLetters.splice(0, deadLetters.length);
    },
  };
};
