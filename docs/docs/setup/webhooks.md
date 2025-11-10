---
title: Webhook delivery pipeline
description: Deploy the Catalyst webhook worker with queueing, retry policies, and telemetry.
---

Catalyst webhook delivery consists of two layers: a queue adapter (Redis, SQS, etc.) and stateless workers that
fetch, sign, and dispatch deliveries.

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for delivery/subscription stores. |
| `REDIS_URL` | Optional. Configure when using the Redis queue adapter. |
| `WEBHOOK_SIGNING_SECRET` | Shared secret used to sign webhook payloads. |
| `WEBHOOK_MAX_ATTEMPTS` | Override default retry policy max attempts. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint for metrics and tracing. |

The worker exposes new telemetry primitives:

- `webhook_worker_runs_total`
- `webhook_worker_run_duration_ms`
- `webhook_worker_deliveries_total` (`status` label tracks `succeeded`, `pending`, `dead_lettered`)

Tracing spans include `webhook_worker.run_once` and `webhook_worker.attempt_delivery` with delivery IDs,
subscription IDs, and retry metadata.

## Deployment guidance

1. **Queue selection.**
   - Use Redis (with persistence) for low-latency scenarios. Configure key eviction policies to `noeviction`.
   - Adopt a managed queue (SQS, GCP Pub/Sub) for high reliability. Implement an adapter that satisfies
     `WebhookQueuePort` and reuse telemetry helpers.

2. **Worker scaling.**
   Workers are stateless. Scale horizontally based on `pending` deliveries or queue depth. Workers are
   idempotent—processing the same delivery twice is safe.

3. **Dead letter handling.**
   - Configure `deadLetterUri` for subscriptions that require manual intervention.
   - Monitor `webhook_worker_deliveries_total{status="dead_lettered"}`. Alert when the rate exceeds your error
     budget.
   - Use the operations runbook to replay dead-lettered deliveries.

4. **Security controls.**
   - Rotate `WEBHOOK_SIGNING_SECRET` regularly. Secrets are namespaced per subscription.
   - Enforce TLS for outbound webhook calls and validate certificates.
   - Store minimal payload data. Sensitive fields should be encrypted at rest via PostgreSQL column-level
     encryption if required.

5. **Containerization.**
   Build a container image running `node dist/index.js --worker`. Configure liveness/readiness probes to
   validate database and queue connectivity.

> Reference the backup/restore runbook for database snapshotting and queue state recovery procedures.
