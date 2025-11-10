# Catalyst Webhook Worker

The webhook worker orchestrates HTTP deliveries for Catalyst webhook subscriptions. It persists delivery attempts in Postgres, computes retry schedules with exponential backoff, and integrates with the pluggable queue port defined in `@catalyst-auth/contracts`.

## Packages

- `@catalyst-auth/webhook-worker` – delivery dispatcher, HTTP worker, and queue orchestration utilities.
- `@catalyst-auth/webhook-queue-redis` – BullMQ/Redis adapter that implements the shared queue contract and surfaces telemetry hooks.

## Running the queue worker

```ts
import { createRedisWebhookQueue } from "@catalyst-auth/webhook-queue-redis";
import { createWebhookQueueWorker } from "@catalyst-auth/webhook-worker";

const queue = createRedisWebhookQueue({
  connection: { host: "127.0.0.1", port: 6379 },
  telemetry: {
    enqueue: (event) => metrics.count("webhook.enqueue", event),
    retry: (event) => metrics.count("webhook.retry", event),
    deadLetter: (event) => metrics.count("webhook.dead_letter", event),
  },
});

const worker = createWebhookQueueWorker(queue, stores, {
  httpClient,
  logger,
  consumer: { concurrency: 5, visibilityTimeoutSeconds: 120 },
});

await worker.start();
```

The worker fetches delivery records from the configured `WebhookDeliveryStorePort`, updates attempt metadata, and uses the queue handle to `ack`, `retry`, or `deadLetter` the job. Retries honour the subscription retry policy. If a `deadLetterUri` is provided, the worker records it in the queue payload so downstream processors can fan-out to alternate transports.

### Operational checklist

- **Postgres** – ensure the webhook deliveries table has appropriate indexes on `status`, `next_attempt_at`, and `subscription_id` to keep store queries efficient.
- **Redis/BullMQ** – enable persistence and configure the queue scheduler for delayed jobs. The Redis adapter exposes `config` (queue names/prefix) and `telemetry` hooks to plug into logging or metrics systems.
- **Observability** – forward `telemetry.error` callbacks from the Redis adapter and `logger` output from the worker to centralized logging. Monitor `retry` and `deadLetter` counters to detect stuck endpoints.
- **Dead-letter handling** – the queue adapter publishes exhausted deliveries to the DLQ with the last error message and optional `deadLetterUri`. Automate DLQ drains or manual replay tooling so operators can re-drive failed webhooks.
- **Graceful shutdown** – call `await worker.stop()` before terminating the process to release queue subscriptions cleanly.

## Testing

Run the package tests with:

```sh
pnpm --filter @catalyst-auth/webhook-worker test
```

The test suite includes queue-driven retry and DLQ flows that use a fake queue implementation to exercise the new contract.
