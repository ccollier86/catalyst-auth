import assert from "node:assert/strict";
import test from "node:test";

import { createTestPostgresDataSource } from "../dist/testing/test-data-source.js";

const unwrapOk = (result) => {
  assert.equal(result.ok, true, `Expected ok result but received error ${JSON.stringify(result.error)}`);
  return result.value;
};

test("creates, updates, lists, and deletes webhook subscriptions", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { webhookSubscriptionStore } = dataSource;

  const created = unwrapOk(
    await webhookSubscriptionStore.createSubscription({
      orgId: "org-123",
      eventTypes: ["user.created", "user.created"],
      targetUrl: "https://example.com/webhook",
      secret: "super-secret",
      headers: { "x-custom": "abc" },
      metadata: { region: "us-east" },
    }),
  );

  assert.equal(created.orgId, "org-123");
  assert.deepEqual(created.eventTypes.sort(), ["user.created"]);
  assert.equal(created.headers["x-custom"], "abc");
  assert.equal(created.active, true);

  const fetched = unwrapOk(await webhookSubscriptionStore.getSubscription(created.id));
  assert.equal(fetched?.id, created.id);

  const listedByEvent = unwrapOk(
    await webhookSubscriptionStore.listSubscriptions({ eventType: "user.created" }),
  );
  assert.equal(listedByEvent.length, 1);

  const updated = unwrapOk(
    await webhookSubscriptionStore.updateSubscription(created.id, {
      headers: { "x-updated": "1" },
      retryPolicy: { maxAttempts: 5, backoffSeconds: [10, 30], deadLetterUri: "s3://dlq" },
      active: false,
    }),
  );

  assert.equal(updated.active, false);
  assert.equal(updated.headers["x-updated"], "1");
  assert.equal(updated.retryPolicy?.maxAttempts, 5);

  const listedInactive = unwrapOk(
    await webhookSubscriptionStore.listSubscriptions({ orgId: "org-123", active: false }),
  );
  assert.equal(listedInactive.length, 1);

  unwrapOk(await webhookSubscriptionStore.deleteSubscription(created.id));
  const afterDelete = unwrapOk(await webhookSubscriptionStore.getSubscription(created.id));
  assert.equal(afterDelete, undefined);
});

test("rejects subscriptions without event types", async () => {
  const dataSource = await createTestPostgresDataSource();
  const { webhookSubscriptionStore } = dataSource;

  const result = await webhookSubscriptionStore.createSubscription({
    eventTypes: [],
    targetUrl: "https://example.com/empty",
    secret: "none",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "webhook.postgres.event_types_required");

  const created = unwrapOk(
    await webhookSubscriptionStore.createSubscription({
      eventTypes: ["user.updated"],
      targetUrl: "https://example.com/hook",
      secret: "init",
    }),
  );

  const update = await webhookSubscriptionStore.updateSubscription(created.id, {
    eventTypes: [],
  });

  assert.equal(update.ok, false);
  assert.equal(update.error.code, "webhook.postgres.event_types_required");
});
