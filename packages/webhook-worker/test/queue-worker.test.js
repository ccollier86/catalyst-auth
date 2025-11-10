import assert from "node:assert/strict";
import test from "node:test";

import { createWebhookQueueWorker } from "../dist/queue-worker.js";

const ok = (value) => ({ ok: true, value });
const err = (error) => ({ ok: false, error });

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
      async listPendingDeliveries() {
        return ok(Array.from(deliveryRecords.values()).map((record) => ({ ...record })));
      },
      async updateDelivery(id, input) {
        const current = deliveryRecords.get(id);
        if (!current) {
          return err({ code: "missing", message: "Delivery not found" });
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

const createFakeQueue = () => {
  const pending = [];
  const acked = [];
  const retried = [];
  const deadLettered = [];
  let handler;
  let nextId = 1;

  const buildHandle = (job) => {
    let settled = false;
    const message = {
      id: job.id,
      deliveryId: job.deliveryId,
      attempt: job.attempt,
      enqueuedAt: job.enqueuedAt,
      metadata: job.metadata,
    };
    return {
      message,
      async ack() {
        if (settled) {
          return ok(undefined);
        }
        settled = true;
        acked.push({ job });
        return ok(undefined);
      },
      async retry(options) {
        if (settled) {
          return ok(undefined);
        }
        settled = true;
        retried.push({ job, options });
        pending.push({
          id: `job-${nextId++}`,
          deliveryId: job.deliveryId,
          attempt: options.nextAttempt,
          enqueuedAt: new Date().toISOString(),
          metadata: { ...job.metadata, ...options.metadata },
        });
        return ok(undefined);
      },
      async deadLetter(options) {
        if (settled) {
          return ok(undefined);
        }
        settled = true;
        deadLettered.push({ job, options });
        return ok(undefined);
      },
    };
  };

  return {
    port: {
      async enqueue(delivery, options) {
        pending.push({
          id: `job-${nextId++}`,
          deliveryId: delivery.deliveryId,
          attempt: delivery.attempt ?? 1,
          enqueuedAt: new Date().toISOString(),
          metadata: options?.metadata,
        });
        return ok(undefined);
      },
      async consume(handlerFn) {
        handler = handlerFn;
        return ok({
          async close() {
            handler = undefined;
          },
        });
      },
    },
    async dispatchNext() {
      if (!handler) {
        throw new Error("No queue handler registered");
      }
      const job = pending.shift();
      if (!job) {
        return false;
      }
      await handler(buildHandle(job));
      return true;
    },
    acked,
    retried,
    deadLettered,
    pending,
  };
};

test("queue worker acknowledges successful deliveries", async () => {
  const clock = createClock([
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:00.000Z",
  ]);
  const stores = createStores({
    subscription: createSubscription(),
    deliveries: [createDelivery()],
  });
  const queue = createFakeQueue();

  const worker = createWebhookQueueWorker(queue.port, stores, {
    clock,
    httpClient: {
      async execute() {
        return { status: 200, headers: {}, body: "{}" };
      },
    },
  });

  const startResult = await worker.start();
  assert.equal(startResult.ok, true);

  const enqueueResult = await queue.port.enqueue({ deliveryId: "del-1" });
  assert.equal(enqueueResult.ok, true);

  await queue.dispatchNext();

  assert.equal(queue.acked.length, 1);
  assert.equal(queue.retried.length, 0);
  assert.equal(queue.deadLettered.length, 0);

  const delivery = stores.dumpDeliveries()[0];
  assert.equal(delivery.status, "succeeded");

  await worker.stop();
});

test("queue worker schedules retries with exponential backoff", async () => {
  const clock = createClock([
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:00.000Z",
  ]);
  const stores = createStores({
    subscription: createSubscription({ retryPolicy: { maxAttempts: 3, backoffSeconds: [30, 60, 120] } }),
    deliveries: [createDelivery()],
  });
  const queue = createFakeQueue();

  const worker = createWebhookQueueWorker(queue.port, stores, {
    clock,
    httpClient: {
      async execute() {
        return { status: 500, headers: {}, body: "error" };
      },
    },
  });

  const startResult = await worker.start();
  assert.equal(startResult.ok, true);
  await queue.port.enqueue({ deliveryId: "del-1" });
  await queue.dispatchNext();

  assert.equal(queue.retried.length, 1);
  const retryCall = queue.retried[0];
  assert.equal(retryCall.options.nextAttempt, 2);
  assert.equal(retryCall.options.delaySeconds, 30);

  const delivery = stores.dumpDeliveries()[0];
  assert.equal(delivery.status, "pending");
  assert.equal(delivery.attemptCount, 1);

  await worker.stop();
});

test("queue worker moves exhausted deliveries to the dead-letter queue", async () => {
  const clock = createClock([
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:00.000Z",
    "2024-01-01T00:00:00.000Z",
  ]);
  const stores = createStores({
    subscription: createSubscription({ retryPolicy: { maxAttempts: 2, backoffSeconds: [30] } }),
    deliveries: [createDelivery({ attemptCount: 1 })],
  });
  const queue = createFakeQueue();

  const worker = createWebhookQueueWorker(queue.port, stores, {
    clock,
    httpClient: {
      async execute() {
        return { status: 500, headers: {}, body: "error" };
      },
    },
  });

  const startResult = await worker.start();
  assert.equal(startResult.ok, true);
  await queue.port.enqueue({ deliveryId: "del-1" });
  await queue.dispatchNext();

  assert.equal(queue.deadLettered.length, 1);
  const dlqCall = queue.deadLettered[0];
  assert.equal(dlqCall.options.attempts, 2);
  assert.equal(dlqCall.options.reason, "HTTP 500");

  const delivery = stores.dumpDeliveries()[0];
  assert.equal(delivery.status, "dead_lettered");

  await worker.stop();
});
