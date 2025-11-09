# Webhook Memory Adapter Plan

## Goal
Provide an in-memory implementation of the `WebhookDeliveryPort` so other services and tests can simulate webhook delivery, retry scheduling, and dead-letter handling without external infrastructure.

## Phases

### Phase 1 – Package Scaffold
- Add `@catalyst-auth/webhook-memory` to the workspace with `package.json`, `tsconfig.json`, and entrypoint exports.
- Ensure build output mirrors existing packages (ESM, NodeNext) and depends only on shared contracts.

### Phase 2 – Delivery Implementation
- Implement a memory-backed delivery adapter that:
  - Accepts injected HTTP client and clock utilities for deterministic testing.
  - Performs JSON POST delivery with signature header generation by default.
  - Translates network/HTTP failures into `Result` errors with retryable metadata.
- Maintain in-memory collections for scheduled retries and dead-lettered events.

### Phase 3 – Retry Scheduling Utilities
- Provide helper APIs to inspect and dequeue scheduled retries in tests.
- Implement retry scheduling respecting policy backoff arrays, max attempts, and dead-letter routing.

### Phase 4 – Tests
- Add a `node:test` suite covering:
  - Successful delivery path with signature generation.
  - Network failure path producing retryable errors.
  - Retry scheduling logic including backoff progression and dead-letter handling when max attempts reached.
  - Deterministic behavior with injected clock and HTTP client spies.

## Completion Criteria
- `pnpm-workspace.yaml` lists the new package.
- TypeScript build succeeds for the new package.
- Tests cover delivery success, failure, retry, and dead-letter behavior.
- No other packages modified beyond necessary configuration exports.
