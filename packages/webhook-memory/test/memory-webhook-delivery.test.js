import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { createMemoryWebhookDelivery } from "../dist/index.js";

const createFixedClock = (isoTimestamp) => {
  const base = new Date(isoTimestamp).getTime();
  return {
    now: () => new Date(base),
  };
};

describe("MemoryWebhookDelivery", () => {
  const event = {
    id: "evt_123",
    type: "user.created",
    occurredAt: "2024-06-01T12:00:00.000Z",
    data: { userId: "user_1" },
    labels: { plan: "pro" },
  };

  const endpoint = {
    id: "wh_1",
    url: "https://example.com/webhook",
    secret: "top-secret",
    eventTypes: ["user.*"],
    headers: { "x-custom": "value" },
    retryPolicy: {
      maxAttempts: 3,
      backoffSeconds: [10, 30, 60],
    },
  };

  it("delivers events with signature header using injected HTTP client", async () => {
    const delivered = [];
    const clock = createFixedClock("2024-06-01T12:34:56.000Z");

    const httpClient = async (request) => {
      delivered.push(request);
      return { status: 200, ok: true };
    };

    const delivery = createMemoryWebhookDelivery({ clock, httpClient, userAgent: "test-agent" });

    const result = await delivery.deliver(event, endpoint);

    assert.equal(result.ok, true, "delivery should succeed");
    assert.equal(result.value.delivered, true);
    assert.notEqual(delivered.length, 0);

    const [request] = delivered;
    assert.equal(request.url, endpoint.url);
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["user-agent"], "test-agent");
    assert.equal(request.headers["x-custom"], "value");
    assert.equal(request.headers["x-catalyst-event-type"], event.type);
    assert.equal(request.headers["x-catalyst-delivery-id"], event.id);

    const signatureHeader = request.headers["x-catalyst-signature"];
    assert.ok(signatureHeader, "signature header expected");

    const parts = signatureHeader.split(",");
    const timestampPart = parts.find((part) => part.startsWith("t="));
    const signaturePart = parts.find((part) => part.startsWith("v1="));

    assert.ok(timestampPart, "timestamp part present");
    assert.ok(signaturePart, "signature part present");

    const timestamp = timestampPart.split("=")[1];
    const signature = signaturePart.split("=")[1];

    const expected = createHmac("sha256", endpoint.secret)
      .update(`${timestamp}.${JSON.stringify(event)}`)
      .digest("hex");
    assert.equal(signature, expected);
  });

  it("returns retryable infra error on network failure", async () => {
    const clock = createFixedClock("2024-06-01T12:34:56.000Z");

    const httpClient = async () => {
      throw new Error("boom");
    };

    const delivery = createMemoryWebhookDelivery({ clock, httpClient });

    const result = await delivery.deliver(event, endpoint);

    assert.equal(result.ok, false, "delivery should fail");
    assert.equal(result.error.code, "webhook.delivery_failed");
    assert.equal(result.error.retryable, true);
    assert.ok(result.error.details);
    assert.equal(result.error.details.endpointId, endpoint.id);
  });

  it("schedules retries and dead-letters when max attempts reached", async () => {
    let current = new Date("2024-06-01T00:00:00.000Z").getTime();
    const clock = {
      now: () => new Date(current),
    };

    const delivery = createMemoryWebhookDelivery({ clock, httpClient: async () => ({ status: 500, ok: false }) });

    // schedule attempt 2
    await delivery.scheduleRetry(event, endpoint, {
      attempt: 1,
      delivered: false,
      statusCode: 500,
      errorMessage: "Server error",
      nextAttemptAt: undefined,
    });

    const [firstRetry] = delivery.peekRetryQueue();
    assert.ok(firstRetry);
    assert.equal(firstRetry.attempt, 2);
    assert.equal(firstRetry.endpoint.id, endpoint.id);
    assert.equal(firstRetry.event.id, event.id);
    assert.equal(firstRetry.scheduledFor, new Date(current + 10_000).toISOString());

    // advance time and schedule beyond max attempts (should dead-letter)
    current += 10_000;

    await delivery.scheduleRetry(event, endpoint, {
      attempt: endpoint.retryPolicy.maxAttempts,
      delivered: false,
      statusCode: 500,
      errorMessage: "Server error",
      nextAttemptAt: undefined,
    });

    assert.equal(delivery.peekRetryQueue().length, 1, "no additional retries enqueued when exceeding max attempts");

    const [deadLetter] = delivery.peekDeadLetters();
    assert.ok(deadLetter);
    assert.equal(deadLetter.attempts, endpoint.retryPolicy.maxAttempts);
    assert.equal(deadLetter.reason, "Max attempts exceeded.");
    assert.equal(deadLetter.event.id, event.id);
  });
});
