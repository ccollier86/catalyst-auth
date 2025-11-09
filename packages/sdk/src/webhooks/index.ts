import {
  type CatalystError,
  type DeliveryResult,
  type Result,
  type WebhookEndpoint,
  type WebhookEventPayload,
} from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createValidationError } from "../shared/errors.js";
import { safeParse } from "../shared/validation.js";

const webhookEndpointSchema: z.ZodType<WebhookEndpoint> = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  secret: z.string().min(1),
  eventTypes: z.array(z.string().min(1)),
  headers: z.record(z.string()).optional(),
  retryPolicy: z
    .object({
      maxAttempts: z.number().int().positive(),
      backoffSeconds: z.array(z.number().int().nonnegative()),
      deadLetterUri: z.string().url().optional(),
    })
    .optional(),
});

const webhookEventSchema: z.ZodType<WebhookEventPayload> = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  occurredAt: z.string().min(1),
  data: z.record(z.unknown()),
  labels: z.record(z.string()).optional(),
});

const deliveryResultSchema: z.ZodType<DeliveryResult> = z.object({
  attempt: z.number().int().nonnegative(),
  delivered: z.boolean(),
  statusCode: z.number().int().optional(),
  errorMessage: z.string().optional(),
  nextAttemptAt: z.string().optional(),
});

/**
 * Webhook delivery helpers exposed by the Catalyst SDK.
 */
export interface WebhooksModule {
  readonly deliverEvent: (
    input: { event: WebhookEventPayload; endpoint: WebhookEndpoint },
  ) => Promise<Result<DeliveryResult, CatalystError>>;
  readonly scheduleRetry: (
    input: { event: WebhookEventPayload; endpoint: WebhookEndpoint; previous: DeliveryResult },
  ) => Promise<Result<null, CatalystError>>;
}

const createDeliverEvent = (deps: CatalystSdkDependencies): WebhooksModule["deliverEvent"] => async (input) => {
  const parsedEvent = safeParse(webhookEventSchema, input.event, createValidationError);
  if (!parsedEvent.ok) {
    return parsedEvent;
  }
  const parsedEndpoint = safeParse(webhookEndpointSchema, input.endpoint, createValidationError);
  if (!parsedEndpoint.ok) {
    return parsedEndpoint;
  }
  return deps.webhookDelivery.deliver(parsedEvent.value, parsedEndpoint.value);
};

const createScheduleRetry = (deps: CatalystSdkDependencies): WebhooksModule["scheduleRetry"] => async (input) => {
  const parsedEvent = safeParse(webhookEventSchema, input.event, createValidationError);
  if (!parsedEvent.ok) {
    return parsedEvent;
  }
  const parsedEndpoint = safeParse(webhookEndpointSchema, input.endpoint, createValidationError);
  if (!parsedEndpoint.ok) {
    return parsedEndpoint;
  }
  const parsedResult = safeParse(deliveryResultSchema, input.previous, createValidationError);
  if (!parsedResult.ok) {
    return parsedResult;
  }
  await deps.webhookDelivery.scheduleRetry(parsedEvent.value, parsedEndpoint.value, parsedResult.value);
  return { ok: true, value: null };
};

/**
 * Creates the {@link WebhooksModule} bound to the provided dependencies.
 */
export const createWebhooksModule = (deps: CatalystSdkDependencies): WebhooksModule => ({
  deliverEvent: createDeliverEvent(deps),
  scheduleRetry: createScheduleRetry(deps),
});
