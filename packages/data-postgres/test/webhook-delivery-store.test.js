import assert from "node:assert/strict";
import test from "node:test";

import { createTestPostgresDataSource } from "../dist/testing/test-data-source.js";

const unwrapOk = (result) => {
  assert.equal(result.ok, true, `Expected ok result but received error ${JSON.stringify(result.error)}`);
  return result.value;
};

test("creates deliveries, updates status, and lists pending items", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { webhookSubscriptionStore, webhookDeliveryStore } = dataSource;

  const subscription = unwrapOk(
    await webhookSubscriptionStore.createSubscription({
      eventTypes: ["key.issued"],
      targetUrl: "https://hooks.example.com/events",
      secret: "hook-secret",
    }),
  );

  const created = unwrapOk(
    await webhookDeliveryStore.createDelivery({
      subscriptionId: subscription.id,
      eventId: "event-1",
      payload: { id: "event-1", type: "key.issued" },
      nextAttemptAt: "2024-01-01T00:00:10.000Z",
    }),
  );

  assert.equal(created.status, "pending");
  assert.equal(created.attemptCount, 0);
  assert.equal(created.nextAttemptAt, "2024-01-01T00:00:10.000Z");

  const fetched = unwrapOk(await webhookDeliveryStore.getDelivery(created.id));
  assert.equal(fetched?.id, created.id);

  const pendingBeforeUpdate = unwrapOk(
    await webhookDeliveryStore.listPendingDeliveries({ before: "2024-01-01T00:00:20.000Z" }),
  );
  assert.equal(pendingBeforeUpdate.length, 1);
  assert.equal(pendingBeforeUpdate[0].status, "pending");

  const updated = unwrapOk(
    await webhookDeliveryStore.updateDelivery(created.id, {
      status: "failed",
      attemptCount: 1,
      lastAttemptAt: "2024-01-01T00:00:11.000Z",
      errorMessage: "Timeout",
      nextAttemptAt: "2024-01-01T00:01:00.000Z",
    }),
  );

  assert.equal(updated.status, "failed");
  assert.equal(updated.attemptCount, 1);
  assert.equal(updated.errorMessage, "Timeout");

  const listed = unwrapOk(
    await webhookDeliveryStore.listDeliveries({ subscriptionId: subscription.id }),
  );
  assert.equal(listed.length, 1);

  const pending = unwrapOk(
    await webhookDeliveryStore.listPendingDeliveries({ before: "2024-01-01T00:02:00.000Z" }),
  );
  assert.equal(pending.length, 0);

  const limitedPending = unwrapOk(
    await webhookDeliveryStore.listPendingDeliveries({ before: "2024-01-01T00:02:00.000Z", limit: 0 }),
  );
  assert.equal(limitedPending.length, 0);

  unwrapOk(
    await webhookDeliveryStore.updateDelivery(created.id, {
      status: "succeeded",
      attemptCount: 2,
      lastAttemptAt: "2024-01-01T00:01:05.000Z",
      nextAttemptAt: null,
      response: { status: 200 },
      errorMessage: null,
    }),
  );

  const succeededPending = unwrapOk(
    await webhookDeliveryStore.listPendingDeliveries({ before: "2024-01-01T00:03:00.000Z" }),
  );
  assert.equal(succeededPending.length, 0);

  unwrapOk(await webhookDeliveryStore.deleteDelivery(created.id));
  const afterDelete = unwrapOk(await webhookDeliveryStore.getDelivery(created.id));
  assert.equal(afterDelete, undefined);
});
