import {
  type CatalystError,
  type ListPendingDeliveriesOptions,
  type ListWebhookDeliveriesOptions,
  type Result,
  type UpdateWebhookDeliveryInput,
  type WebhookDeliveryRecord,
  type WebhookDeliveryStatus,
} from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createValidationError } from "../shared/errors.js";
import { safeParse } from "../shared/validation.js";

const deliveryStatuses = [
  "pending",
  "delivering",
  "succeeded",
  "failed",
  "dead_lettered",
] as const satisfies ReadonlyArray<WebhookDeliveryStatus>;

const deliveryStatusSchema: z.ZodType<WebhookDeliveryStatus> = z.enum(deliveryStatuses);

const updateInputSchema: z.ZodType<{ id: string; changes: UpdateWebhookDeliveryInput }> = z.object({
  id: z.string().min(1),
  changes: z.object({
    status: deliveryStatusSchema.optional(),
    attemptCount: z.number().int().nonnegative().optional(),
    lastAttemptAt: z.string().min(1).optional(),
    nextAttemptAt: z.string().min(1).optional(),
    response: z.record(z.unknown()).optional(),
    errorMessage: z.string().optional(),
    updatedAt: z.string().min(1).optional(),
  }),
});

const getInputSchema: z.ZodType<{ id: string }> = z.object({ id: z.string().min(1) });

const deleteInputSchema: z.ZodType<{ id: string }> = z.object({ id: z.string().min(1) });

const listInputSchema: z.ZodType<ListWebhookDeliveriesOptions> = z.object({
  subscriptionId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  status: deliveryStatusSchema.optional(),
  limit: z.number().int().positive().optional(),
});

const listPendingInputSchema: z.ZodType<ListPendingDeliveriesOptions> = z.object({
  before: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
});

type UpdateDeliveryArgs = {
  readonly id: string;
  readonly changes: {
    readonly status?: WebhookDeliveryStatus;
    readonly attemptCount?: number;
    readonly lastAttemptAt?: string | null;
    readonly nextAttemptAt?: string | null;
    readonly response?: Record<string, unknown> | null;
    readonly errorMessage?: string | null;
    readonly updatedAt?: string;
  };
};

type GetDeliveryArgs = z.infer<typeof getInputSchema>;
type DeleteDeliveryArgs = z.infer<typeof deleteInputSchema>;
type ListDeliveriesArgs = ListWebhookDeliveriesOptions;
type ListPendingArgs = ListPendingDeliveriesOptions;

const sanitizeDeliveryChanges = (
  changes: UpdateDeliveryArgs["changes"],
): { sanitized: UpdateWebhookDeliveryInput; nulls: { lastAttemptAt?: true; nextAttemptAt?: true; response?: true; errorMessage?: true } } => {
  let sanitized: UpdateWebhookDeliveryInput = {};
  const nulls: { lastAttemptAt?: true; nextAttemptAt?: true; response?: true; errorMessage?: true } = {};

  if (changes.status !== undefined) {
    sanitized = { ...sanitized, status: changes.status };
  }

  if (changes.attemptCount !== undefined) {
    sanitized = { ...sanitized, attemptCount: changes.attemptCount };
  }

  if ("lastAttemptAt" in changes) {
    if (changes.lastAttemptAt === null) {
      nulls.lastAttemptAt = true;
    } else if (changes.lastAttemptAt !== undefined) {
      sanitized = { ...sanitized, lastAttemptAt: changes.lastAttemptAt };
    }
  }

  if ("nextAttemptAt" in changes) {
    if (changes.nextAttemptAt === null) {
      nulls.nextAttemptAt = true;
    } else if (changes.nextAttemptAt !== undefined) {
      sanitized = { ...sanitized, nextAttemptAt: changes.nextAttemptAt };
    }
  }

  if ("response" in changes) {
    if (changes.response === null) {
      nulls.response = true;
    } else if (changes.response !== undefined) {
      sanitized = { ...sanitized, response: changes.response };
    }
  }

  if ("errorMessage" in changes) {
    if (changes.errorMessage === null) {
      nulls.errorMessage = true;
    } else if (changes.errorMessage !== undefined) {
      sanitized = { ...sanitized, errorMessage: changes.errorMessage };
    }
  }

  if (changes.updatedAt) {
    sanitized = { ...sanitized, updatedAt: changes.updatedAt };
  }

  return { sanitized, nulls };
};

const applyDeliveryNulls = (
  parsed: UpdateWebhookDeliveryInput,
  nulls: { lastAttemptAt?: true; nextAttemptAt?: true; response?: true; errorMessage?: true },
): UpdateWebhookDeliveryInput => {
  let next: UpdateWebhookDeliveryInput = { ...parsed };
  if (nulls.lastAttemptAt) {
    next = { ...next, lastAttemptAt: null };
  }
  if (nulls.nextAttemptAt) {
    next = { ...next, nextAttemptAt: null };
  }
  if (nulls.response) {
    next = { ...next, response: null };
  }
  if (nulls.errorMessage) {
    next = { ...next, errorMessage: null };
  }
  return next;
};

export interface WebhookDeliveriesModule {
  readonly getDelivery: (
    input: GetDeliveryArgs,
  ) => Promise<Result<WebhookDeliveryRecord | undefined, CatalystError>>;
  readonly listDeliveries: (
    input?: ListDeliveriesArgs,
  ) => Promise<Result<ReadonlyArray<WebhookDeliveryRecord>, CatalystError>>;
  readonly listPendingDeliveries: (
    input?: ListPendingArgs,
  ) => Promise<Result<ReadonlyArray<WebhookDeliveryRecord>, CatalystError>>;
  readonly updateDelivery: (
    input: UpdateDeliveryArgs,
  ) => Promise<Result<WebhookDeliveryRecord, CatalystError>>;
  readonly deleteDelivery: (
    input: DeleteDeliveryArgs,
  ) => Promise<Result<null, CatalystError>>;
}

const createGetDelivery = (
  deps: CatalystSdkDependencies,
): WebhookDeliveriesModule["getDelivery"] => async (input) => {
  const parsed = safeParse(getInputSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.webhookDeliveryStore.getDelivery(parsed.value.id);
};

const createListDeliveries = (
  deps: CatalystSdkDependencies,
): WebhookDeliveriesModule["listDeliveries"] => async (input) => {
  const parsed = safeParse(listInputSchema, input ?? {}, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.webhookDeliveryStore.listDeliveries(parsed.value);
};

const createListPendingDeliveries = (
  deps: CatalystSdkDependencies,
): WebhookDeliveriesModule["listPendingDeliveries"] => async (input) => {
  const parsed = safeParse(listPendingInputSchema, input ?? {}, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.webhookDeliveryStore.listPendingDeliveries(parsed.value);
};

const createUpdateDelivery = (
  deps: CatalystSdkDependencies,
): WebhookDeliveriesModule["updateDelivery"] => async (input) => {
  const { sanitized, nulls } = sanitizeDeliveryChanges(input.changes);
  const parsed = safeParse(
    updateInputSchema,
    { id: input.id, changes: sanitized },
    createValidationError,
  );
  if (!parsed.ok) {
    return parsed;
  }
  const nextChanges = applyDeliveryNulls(parsed.value.changes, nulls);
  return deps.webhookDeliveryStore.updateDelivery(parsed.value.id, nextChanges);
};

const createDeleteDelivery = (
  deps: CatalystSdkDependencies,
): WebhookDeliveriesModule["deleteDelivery"] => async (input) => {
  const parsed = safeParse(deleteInputSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const result = await deps.webhookDeliveryStore.deleteDelivery(parsed.value.id);
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: null };
};

export const createWebhookDeliveriesModule = (
  deps: CatalystSdkDependencies,
): WebhookDeliveriesModule => ({
  getDelivery: createGetDelivery(deps),
  listDeliveries: createListDeliveries(deps),
  listPendingDeliveries: createListPendingDeliveries(deps),
  updateDelivery: createUpdateDelivery(deps),
  deleteDelivery: createDeleteDelivery(deps),
});
