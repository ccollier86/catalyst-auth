import {
  type CatalystError,
  type CreateWebhookSubscriptionInput,
  type ListWebhookSubscriptionsOptions,
  type Result,
  type UpdateWebhookSubscriptionInput,
  type WebhookRetryPolicy,
  type WebhookSubscriptionRecord,
} from "@catalyst-auth/contracts";
import { z } from "../vendor/zod.js";

import type { CatalystSdkDependencies } from "../index.js";
import { createValidationError } from "../shared/errors.js";
import { safeParse } from "../shared/validation.js";

const retryPolicySchema: z.ZodType<WebhookRetryPolicy> = z.object({
  maxAttempts: z.number().int().positive(),
  backoffSeconds: z.array(z.number().int().nonnegative()),
  deadLetterUri: z.string().url().optional(),
});

const createInputSchema: z.ZodType<{ subscription: CreateWebhookSubscriptionInput }> = z.object({
  subscription: z.object({
    id: z.string().min(1).optional(),
    orgId: z.string().min(1).optional(),
    eventTypes: z.array(z.string().min(1)).min(1),
    targetUrl: z.string().url(),
    secret: z.string().min(1),
    headers: z.record(z.string()).optional(),
    retryPolicy: retryPolicySchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    active: z.boolean().optional(),
    createdAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional(),
  }),
});

const updateInputSchema: z.ZodType<{ id: string; changes: UpdateWebhookSubscriptionInput }> = z.object({
  id: z.string().min(1),
  changes: z.object({
    orgId: z.string().min(1).optional(),
    eventTypes: z.array(z.string().min(1)).min(1).optional(),
    targetUrl: z.string().url().optional(),
    secret: z.string().min(1).optional(),
    headers: z.record(z.string()).optional(),
    retryPolicy: retryPolicySchema.optional(),
    metadata: z.record(z.unknown()).optional(),
    active: z.boolean().optional(),
    updatedAt: z.string().min(1).optional(),
  }),
});

const getInputSchema: z.ZodType<{ id: string }> = z.object({ id: z.string().min(1) });

const deleteInputSchema: z.ZodType<{ id: string }> = z.object({ id: z.string().min(1) });

type ListSubscriptionsInput = { orgId?: string; active?: boolean; eventType?: string };

const listInputSchema: z.ZodType<ListSubscriptionsInput> = z.object({
  orgId: z.string().min(1).optional(),
  active: z.boolean().optional(),
  eventType: z.string().min(1).optional(),
});

type CreateSubscriptionArgs = z.infer<typeof createInputSchema>;

type UpdateSubscriptionArgs = {
  readonly id: string;
  readonly changes: {
    readonly orgId?: string | null;
    readonly eventTypes?: ReadonlyArray<string>;
    readonly targetUrl?: string;
    readonly secret?: string;
    readonly headers?: Record<string, string> | null;
    readonly retryPolicy?: WebhookRetryPolicy | null;
    readonly metadata?: Record<string, unknown> | null;
    readonly active?: boolean;
    readonly updatedAt?: string;
  };
};

type GetSubscriptionArgs = z.infer<typeof getInputSchema>;
type DeleteSubscriptionArgs = z.infer<typeof deleteInputSchema>;
type ListSubscriptionsArgs = { readonly orgId?: string | null; readonly active?: boolean; readonly eventType?: string };

const sanitizeSubscriptionChanges = (
  changes: UpdateSubscriptionArgs["changes"],
): { sanitized: UpdateWebhookSubscriptionInput; nulls: { orgId?: true; headers?: true; retryPolicy?: true; metadata?: true } } => {
  let sanitized: UpdateWebhookSubscriptionInput = {};
  const nulls: { orgId?: true; headers?: true; retryPolicy?: true; metadata?: true } = {};

  if ("orgId" in changes) {
    if (changes.orgId === null) {
      nulls.orgId = true;
    } else if (changes.orgId !== undefined) {
      sanitized = { ...sanitized, orgId: changes.orgId };
    }
  }

  if (changes.eventTypes) {
    sanitized = { ...sanitized, eventTypes: [...changes.eventTypes] };
  }

  if (changes.targetUrl) {
    sanitized = { ...sanitized, targetUrl: changes.targetUrl };
  }

  if (changes.secret) {
    sanitized = { ...sanitized, secret: changes.secret };
  }

  if ("headers" in changes) {
    if (changes.headers === null) {
      nulls.headers = true;
    } else if (changes.headers !== undefined) {
      sanitized = { ...sanitized, headers: changes.headers };
    }
  }

  if ("retryPolicy" in changes) {
    if (changes.retryPolicy === null) {
      nulls.retryPolicy = true;
    } else if (changes.retryPolicy !== undefined) {
      sanitized = { ...sanitized, retryPolicy: changes.retryPolicy };
    }
  }

  if ("metadata" in changes) {
    if (changes.metadata === null) {
      nulls.metadata = true;
    } else if (changes.metadata !== undefined) {
      sanitized = { ...sanitized, metadata: changes.metadata };
    }
  }

  if (changes.active !== undefined) {
    sanitized = { ...sanitized, active: changes.active };
  }

  if (changes.updatedAt) {
    sanitized = { ...sanitized, updatedAt: changes.updatedAt };
  }

  return { sanitized, nulls };
};

const applySubscriptionNulls = (
  parsed: UpdateWebhookSubscriptionInput,
  nulls: { orgId?: true; headers?: true; retryPolicy?: true; metadata?: true },
): UpdateWebhookSubscriptionInput => {
  let next: UpdateWebhookSubscriptionInput = { ...parsed };
  if (nulls.orgId) {
    next = { ...next, orgId: null };
  }
  if (nulls.headers) {
    next = { ...next, headers: null };
  }
  if (nulls.retryPolicy) {
    next = { ...next, retryPolicy: null };
  }
  if (nulls.metadata) {
    next = { ...next, metadata: null };
  }
  return next;
};

const sanitizeListInput = (
  input: ListSubscriptionsArgs | undefined,
): { sanitized: ListSubscriptionsInput; orgIdNull: boolean } => {
  if (!input) {
    return { sanitized: {}, orgIdNull: false };
  }
  let sanitized: ListSubscriptionsInput = {};
  let orgIdNull = false;

  if ("orgId" in input) {
    if (input.orgId === null) {
      orgIdNull = true;
    } else if (input.orgId !== undefined) {
      sanitized = { ...sanitized, orgId: input.orgId };
    }
  }

  if (input.active !== undefined) {
    sanitized = { ...sanitized, active: input.active };
  }

  if (input.eventType !== undefined) {
    sanitized = { ...sanitized, eventType: input.eventType };
  }

  return { sanitized, orgIdNull };
};

export interface WebhookSubscriptionsModule {
  readonly createSubscription: (
    input: CreateSubscriptionArgs,
  ) => Promise<Result<WebhookSubscriptionRecord, CatalystError>>;
  readonly updateSubscription: (
    input: UpdateSubscriptionArgs,
  ) => Promise<Result<WebhookSubscriptionRecord, CatalystError>>;
  readonly getSubscription: (
    input: GetSubscriptionArgs,
  ) => Promise<Result<WebhookSubscriptionRecord | undefined, CatalystError>>;
  readonly listSubscriptions: (
    input?: ListSubscriptionsArgs,
  ) => Promise<Result<ReadonlyArray<WebhookSubscriptionRecord>, CatalystError>>;
  readonly deleteSubscription: (
    input: DeleteSubscriptionArgs,
  ) => Promise<Result<null, CatalystError>>;
}

const createCreateSubscription = (
  deps: CatalystSdkDependencies,
): WebhookSubscriptionsModule["createSubscription"] => async (input) => {
  const parsed = safeParse(createInputSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.webhookSubscriptionStore.createSubscription(parsed.value.subscription);
};

const createUpdateSubscription = (
  deps: CatalystSdkDependencies,
): WebhookSubscriptionsModule["updateSubscription"] => async (input) => {
  const { sanitized, nulls } = sanitizeSubscriptionChanges(input.changes);
  const parsed = safeParse(
    updateInputSchema,
    { id: input.id, changes: sanitized },
    createValidationError,
  );
  if (!parsed.ok) {
    return parsed;
  }
  const nextChanges = applySubscriptionNulls(parsed.value.changes, nulls);
  return deps.webhookSubscriptionStore.updateSubscription(parsed.value.id, nextChanges);
};

const createGetSubscription = (
  deps: CatalystSdkDependencies,
): WebhookSubscriptionsModule["getSubscription"] => async (input) => {
  const parsed = safeParse(getInputSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  return deps.webhookSubscriptionStore.getSubscription(parsed.value.id);
};

const createListSubscriptions = (
  deps: CatalystSdkDependencies,
): WebhookSubscriptionsModule["listSubscriptions"] => async (input) => {
  const { sanitized, orgIdNull } = sanitizeListInput(input);
  const parsed = safeParse(listInputSchema, sanitized, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const baseOptions: ListWebhookSubscriptionsOptions = { ...parsed.value };
  const options = orgIdNull ? { ...baseOptions, orgId: null } : baseOptions;
  return deps.webhookSubscriptionStore.listSubscriptions(options);
};

const createDeleteSubscription = (
  deps: CatalystSdkDependencies,
): WebhookSubscriptionsModule["deleteSubscription"] => async (input) => {
  const parsed = safeParse(deleteInputSchema, input, createValidationError);
  if (!parsed.ok) {
    return parsed;
  }
  const result = await deps.webhookSubscriptionStore.deleteSubscription(parsed.value.id);
  if (!result.ok) {
    return result;
  }
  return { ok: true, value: null };
};

export const createWebhookSubscriptionsModule = (
  deps: CatalystSdkDependencies,
): WebhookSubscriptionsModule => ({
  createSubscription: createCreateSubscription(deps),
  updateSubscription: createUpdateSubscription(deps),
  getSubscription: createGetSubscription(deps),
  listSubscriptions: createListSubscriptions(deps),
  deleteSubscription: createDeleteSubscription(deps),
});
