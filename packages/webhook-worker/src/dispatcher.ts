import {
  ok,
  type CatalystError,
  type CreateWebhookDeliveryInput,
  type ListWebhookSubscriptionsOptions,
  type Result,
  type WebhookDeliveryRecord,
  type WebhookDeliveryStorePort,
  type WebhookSubscriptionRecord,
  type WebhookSubscriptionStorePort,
} from "@catalyst-auth/contracts";

import { clone } from "./utils.js";
import type {
  Clock,
  DispatcherEventInput,
  DispatcherOutcome,
  DispatcherResult,
  Logger,
} from "./types.js";

type SubscriptionStore = WebhookSubscriptionStorePort;
type DeliveryStore = WebhookDeliveryStorePort;

type StoreResult<TValue> = Promise<Result<TValue, CatalystError>>;

const defaultClock: Clock = {
  now: () => new Date(),
};

const buildListOptions = (input: DispatcherEventInput): ListWebhookSubscriptionsOptions => ({
  orgId: input.orgId ?? undefined,
  active: true,
  eventType: input.eventType,
});

const toDeliveryInput = (
  subscription: WebhookSubscriptionRecord,
  event: DispatcherEventInput,
  clock: Clock,
): CreateWebhookDeliveryInput => {
  const now = clock.now().toISOString();
  return {
    subscriptionId: subscription.id,
    eventId: event.eventId,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: now,
    payload: clone(event.payload),
    createdAt: now,
    updatedAt: now,
  } satisfies CreateWebhookDeliveryInput;
};

const handleDeliveryCreation = async (
  deliveryStore: DeliveryStore,
  input: CreateWebhookDeliveryInput,
): StoreResult<WebhookDeliveryRecord> => deliveryStore.createDelivery(input);

export interface WebhookDispatcherOptions {
  readonly clock?: Clock;
  readonly logger?: Logger;
}

export class WebhookDispatcher {
  private readonly clock: Clock;
  private readonly logger?: Logger;

  constructor(
    private readonly subscriptionStore: SubscriptionStore,
    private readonly deliveryStore: DeliveryStore,
    options: WebhookDispatcherOptions = {},
  ) {
    this.clock = options.clock ?? defaultClock;
    this.logger = options.logger;
  }

  async dispatch(event: DispatcherEventInput): Promise<DispatcherOutcome> {
    const listResult = await this.subscriptionStore.listSubscriptions(buildListOptions(event));
    if (!listResult.ok) {
      return listResult;
    }

    const subscriptions = listResult.value.filter((subscription) => subscription.active);
    if (subscriptions.length === 0) {
      this.logger?.debug?.("webhook.dispatcher.no_subscribers", {
        eventType: event.eventType,
        orgId: event.orgId ?? undefined,
      });
      return ok({ deliveries: [] });
    }

    const deliveries: WebhookDeliveryRecord[] = [];

    for (const subscription of subscriptions) {
      const createResult = await handleDeliveryCreation(
        this.deliveryStore,
        toDeliveryInput(subscription, event, this.clock),
      );

      if (!createResult.ok) {
        this.logger?.error?.("webhook.dispatcher.create_failed", {
          subscriptionId: subscription.id,
          eventId: event.eventId,
          error: createResult.error,
        });
        return createResult;
      }

      deliveries.push(createResult.value);
    }

    return ok({ deliveries } satisfies DispatcherResult);
  }
}
