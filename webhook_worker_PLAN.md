# Webhook Worker Plan

## Goal
Deliver production-ready webhook processing that consumes events, schedules deliveries via Postgres-backed stores, and performs HTTP dispatch with retry handling.

## Phases

### Phase 1 – Package Scaffold
- Create `@catalyst-auth/webhook-worker` with `package.json`, `tsconfig.json`, and entry exports for worker utilities.
- Ensure build/test scripts align with existing packages and depend only on shared contracts/data-postgres packages.

### Phase 2 – Core Services
- Implement a `WebhookDispatcher` that lists active subscriptions for an event type and creates delivery records using the Postgres stores.
- Implement a `WebhookDeliveryWorker` that polls pending deliveries, marks them delivering, and updates status/results after attempting HTTP delivery.
- Provide injectable dependencies for HTTP client, clock, and ID generation to satisfy DI guidelines.

### Phase 3 – Retry & Signing Logic
- Add retry scheduling using subscription-level retry policies (max attempts, backoff seconds, dead-letter URI fallback).
- Generate HMAC signatures for payloads and attach configurable headers during dispatch.
- Record structured response/error payloads for observability in delivery records.

### Phase 4 – Tests
- Add `node:test` suites covering dispatcher fan-out, successful delivery, retry scheduling, and dead-letter transitions.
- Mock HTTP client/clock to achieve deterministic behavior without external calls.

## Completion Criteria
- TypeScript build succeeds for the new package.
- Tests cover dispatcher and worker flows (success, retry, dead-letter).
- Postgres data source exposes the dispatcher/worker through dependency injection-friendly factories.
- No regression to existing packages; forward-auth and SDK continue to build against the new exports.
