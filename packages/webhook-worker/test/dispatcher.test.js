import assert from "node:assert/strict";
import test from "node:test";

import {
  WebhookDispatcher,
} from "../dist/dispatcher.js";

const ok = (value) => ({ ok: true, value });
const err = (error) => ({ ok: false, error });

const createSubscription = (overrides = {}) => ({
  id: overrides.id ?? `sub-${Math.random().toString(16).slice(2)}`,
  orgId: overrides.orgId,
  eventTypes: overrides.eventTypes ?? ["user.created"],
  targetUrl: overrides.targetUrl ?? "https://example.com/webhook",
  secret: overrides.secret ?? "secret",
  headers: overrides.headers ?? {},
  retryPolicy: overrides.retryPolicy,
  active: overrides.active ?? true,
  createdAt: overrides.createdAt ?? new Date().toISOString(),
  updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  metadata: overrides.metadata,
});

const createDispatcher = ({ subscriptions = [], deliveries = [] } = {}) => {
  const subscriptionStore = {
    listSubscriptions: async () => ok(subscriptions),
  };

  const created = [];
  const deliveryStore = {
    async createDelivery(input) {
      const record = {
        id: input.id ?? `del-${created.length + 1}`,
        subscriptionId: input.subscriptionId,
        eventId: input.eventId,
        status: input.status ?? "pending",
        attemptCount: input.attemptCount ?? 0,
        lastAttemptAt: input.lastAttemptAt,
        nextAttemptAt: input.nextAttemptAt,
        payload: input.payload,
        response: input.response,
        errorMessage: input.errorMessage,
        createdAt: input.createdAt ?? new Date().toISOString(),
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };
      created.push(record);
      deliveries.push(record);
      return ok(record);
    },
  };

  return {
    dispatcher: new WebhookDispatcher(subscriptionStore, deliveryStore, {
      clock: { now: () => new Date("2024-01-01T00:00:00.000Z") },
    }),
    created,
    deliveries,
  };
};

test("dispatch fan-outs deliveries to active subscriptions", async () => {
  const event = {
    eventId: "evt-1",
    eventType: "user.created",
    payload: { userId: "user-1" },
    orgId: "org-1",
  };

  const active = createSubscription({ id: "sub-1", orgId: "org-1" });
  const inactive = createSubscription({ id: "sub-2", active: false });

  const { dispatcher, created } = createDispatcher({ subscriptions: [active, inactive] });
  const result = await dispatcher.dispatch(event);

  assert.equal(result.ok, true, `expected ok result but got ${JSON.stringify(result.error)}`);
  assert.equal(result.value.deliveries.length, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].subscriptionId, "sub-1");
  assert.equal(created[0].eventId, "evt-1");
  assert.equal(created[0].status, "pending");
  assert.equal(created[0].attemptCount, 0);
  assert.equal(created[0].nextAttemptAt, "2024-01-01T00:00:00.000Z");
});

test("propagates store errors", async () => {
  const failingStore = {
    listSubscriptions: async () => err({ code: "boom", message: "nope" }),
  };
  const deliveryStore = {
    createDelivery: async () => ok(undefined),
  };

  const dispatcher = new WebhookDispatcher(failingStore, deliveryStore);
  const result = await dispatcher.dispatch({
    eventId: "evt-1",
    eventType: "user.created",
    payload: {},
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, { code: "boom", message: "nope" });
});
