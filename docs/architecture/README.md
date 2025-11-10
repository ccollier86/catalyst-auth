# Catalyst Auth architecture notes

This directory contains deep-dive design documents, diagrams, and ADRs. Each file focuses on a specific
subsystem. Keep the notes in sync with implementation changes.

- [`forward-auth.md`](./forward-auth.md) – Edge deployment models, cache integration, and observability strategy.
- [`webhooks.md`](./webhooks.md) – Queue adapter contracts, retry/backoff algorithms, and dead-letter processing.
- [`data-model.md`](./data-model.md) – Entity relationships, migration workflow, and indexing guidance.
