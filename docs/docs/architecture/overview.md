---
title: Architecture overview
description: High-level architecture, component responsibilities, and links to deep-dive design notes.
---

Catalyst Auth is composed of interoperable packages that implement the ports defined in `@catalyst-auth/contracts`.

## Component map

- **SDK (`@catalyst-auth/sdk`)** — Client-facing module that orchestrates adapters and surfaces tracing, metrics,
  and structured logging via the shared telemetry helpers.
- **Data services (`@catalyst-auth/data-postgres`)** — PostgreSQL-backed repositories with transaction management,
  cache invalidation, and telemetry instrumentation.
- **Forward-auth** — Serverless-friendly edge component that validates sessions, enforces policy, and exposes
  health/metrics endpoints.
- **Webhook worker** — Delivery engine that retries, dead-letters, and emits observability signals for every
  delivery attempt.

## Telemetry pipeline

1. All packages import helpers from `@catalyst-auth/telemetry` to create meters, tracers, and structured loggers.
2. Spans are started around critical operations (`sdk.*`, `postgres.query`, `forward_auth.request`,
   `webhook_worker.run_once`).
3. Metrics feed Prometheus-style counters/histograms that power SLO dashboards.
4. Logs are emitted in JSON with consistent fields (`service`, `route`, `status`, `deliveryId`).

## Architecture notes

Detailed sequence diagrams, ADRs, and performance investigations live under
[`docs/architecture/`](../../architecture/README.md). Key documents include:

- **`docs/architecture/forward-auth.md`** — Reverse proxy integration patterns.
- **`docs/architecture/webhooks.md`** — Queueing, retry semantics, and failure handling.
- **`docs/architecture/data-model.md`** — Schema overview and migration strategy.

> Contributions should update both the code and the corresponding architecture note to keep design intent in sync.
