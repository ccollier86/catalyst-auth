import assert from "node:assert/strict";
import test from "node:test";

import { WebhookDeliveryWorker } from "../dist/worker.js";

const ok = (value) => ({ ok: true, value });

const createClock = (timestamps) => {
  let index = 0;
  return {
    now() {
      const value = timestamps[Math.min(index, timestamps.length - 1)];
      index += 1;
      return new Date(value);
    },
  };
};

const createSubscription = (overrides = {}) => ({
  id: overrides.id ?? "sub-1",
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

const createDelivery = (overrides = {}) => ({
  id: overrides.id ?? "del-1",
  subscriptionId: overrides.subscriptionId ?? "sub-1",
  eventId: overrides.eventId ?? "evt-1",
  status: overrides.status ?? "pending",
  attemptCount: overrides.attemptCount ?? 0,
  lastAttemptAt: overrides.lastAttemptAt,
  nextAttemptAt: overrides.nextAttemptAt ?? "2024-01-01T00:00:00.000Z",
  payload: overrides.payload ?? { hello: "world" },
  response: overrides.response,
  errorMessage: overrides.errorMessage,
  createdAt: overrides.createdAt ?? "2024-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2024-01-01T00:00:00.000Z",
});

const createStores = ({ subscription, deliveries }) => {
  const deliveryRecords = new Map(deliveries.map((record) => [record.id, { ...record }]));
  return {
    subscriptions: {
      async getSubscription(id) {
        if (!subscription || subscription.id !== id) {
          return ok(undefined);
        }
        return ok({ ...subscription });
      },
    },
    deliveries: {
      async getDelivery(id) {
        const record = deliveryRecords.get(id);
        return ok(record ? { ...record } : undefined);
      },
      async listPendingDeliveries({ before, limit }) {
        const cutoff = before ? new Date(before).getTime() : Number.POSITIVE_INFINITY;
        const results = [];
        for (const record of deliveryRecords.values()) {
          if (record.status !== "pending") {
            continue;
          }
          const next = record.nextAttemptAt ? new Date(record.nextAttemptAt).getTime() : 0;
          if (next <= cutoff) {
            results.push({ ...record });
          }
          if (limit && results.length >= limit) {
            break;
          }
        }
        results.sort((a, b) => new Date(a.nextAttemptAt ?? 0).getTime() - new Date(b.nextAttemptAt ?? 0).getTime());
        return ok(results);
      },
      async updateDelivery(id, input) {
        const current = deliveryRecords.get(id);
        if (!current) {
          return { ok: false, error: { code: "missing", message: "Delivery not found" } };
        }
        const updated = {
          ...current,
          ...input,
        };
        deliveryRecords.set(id, updated);
        return ok({ ...updated });
      },
    },
    dumpDeliveries: () => Array.from(deliveryRecords.values()).map((record) => ({ ...record })),
  };
};

test("marks deliveries succeeded when HTTP returns 2xx", async () => {
  const clock = createClock(["2024-01-01T00:00:00.000Z", "2024-01-01T00:00:05.000Z"]);
  const stores = createStores({
    subscription: createSubscription(),
    deliveries: [createDelivery()],
  });

  const worker = new WebhookDeliveryWorker(stores, {
    clock,
    httpClient: {
      async execute() {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: "{}",
        };
      },
    },
  });

  const result = await worker.runOnce();
  assert.equal(result.ok, true, `expected ok result but received ${JSON.stringify(result.error)}`);
  assert.deepEqual(result.value, { total: 1, succeeded: 1, retried: 0, deadLettered: 0 });

  const delivery = stores.dumpDeliveries()[0];
  assert.equal(delivery.status, "succeeded");
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.nextAttemptAt, null);
  assert.equal(delivery.errorMessage, null);
  assert.deepEqual(delivery.response, {
    status: 200,
    headers: { "content-type": "application/json" },
    body: "{}",
  });
});

test("schedules retry when response is non-2xx", async () => {
  const clock = createClock([
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:05.000Z",
    "2024-01-01T00:00:05.000Z",
  ]);
  const stores = createStores({
    subscription: createSubscription({ retryPolicy: { maxAttempts: 3, backoffSeconds: [30] } }),
    deliveries: [createDelivery()],
  });

  const worker = new WebhookDeliveryWorker(stores, {
    clock,
    httpClient: {
      async execute() {
        return {
          status: 500,
          headers: { "content-type": "application/json" },
          body: "{\"error\":true}",
        };
      },
    },
  });

  const result = await worker.runOnce();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { total: 1, succeeded: 0, retried: 1, deadLettered: 0 });

  const delivery = stores.dumpDeliveries()[0];
  assert.equal(delivery.status, "pending");
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.errorMessage, "HTTP 500");
  assert.equal(delivery.nextAttemptAt, "2024-01-01T00:00:35.000Z");
});

test("dead-letters when max attempts reached", async () => {
  const clock = createClock([
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:05.000Z",
    "2024-01-01T00:00:05.000Z",
  ]);
  const stores = createStores({
    subscription: createSubscription({ retryPolicy: { maxAttempts: 2, backoffSeconds: [30] } }),
    deliveries: [createDelivery({ attemptCount: 1 })],
  });

  const worker = new WebhookDeliveryWorker(stores, {
    clock,
    httpClient: {
      async execute() {
        return {
          status: 500,
          headers: {},
        };
      },
    },
  });

  const result = await worker.runOnce();
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { total: 1, succeeded: 0, retried: 0, deadLettered: 1 });

  const delivery = stores.dumpDeliveries()[0];
  assert.equal(delivery.status, "dead_lettered");
  assert.equal(delivery.attemptCount, 2);
  assert.equal(delivery.nextAttemptAt, null);
  assert.equal(delivery.errorMessage, "HTTP 500");
});

test("dead-letters when subscription missing", async () => {
  const clock = createClock(["2024-01-01T00:00:00.000Z"]);
  const stores = createStores({
    subscription: undefined,
    deliveries: [createDelivery()],
  });

  const worker = new WebhookDeliveryWorker(stores, { clock });
  const result = await worker.runOnce();

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { total: 1, succeeded: 0, retried: 0, deadLettered: 1 });

  const delivery = stores.dumpDeliveries()[0];
  assert.equal(delivery.status, "dead_lettered");
  assert.equal(delivery.errorMessage, "Webhook subscription not found.");
});
