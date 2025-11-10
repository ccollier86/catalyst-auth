# Catalyst Auth Overview & Status

## Project Summary
Catalyst Auth is a TypeScript authentication platform that layers a developer-friendly experience on top of Authentik. The system combines a Postgres-backed data plane (profiles, memberships, entitlements, sessions, keys, audit, webhooks) with runtime services (forward-auth middleware, webhook delivery workers), an SDK, and upcoming headless UI/admin components. The architecture follows strict separation of responsibilities, dependency inversion, and single-owner data boundaries as outlined in `arch-guide.md`.

Key pillars from `vision.md`:
- **Multi-tenant identity:** orgs, memberships, entitlements, and effective identity merging.
- **Forward-auth native:** Traefik/Elysia helpers and decision token caching.
- **Headless UI & admin tooling:** drop-in components powered by the SDK.
- **Webhooks & automation:** configurable registry, retrying delivery worker, and MCP runbooks.
- **Zero technical debt:** DI everywhere, generated vendor types, strict TypeScript builds.

## Repository Layout
- `packages/contracts` – Shared ports/interfaces used across adapters and services.
- `packages/data-postgres` – Postgres executors, migrations, repositories, and seeding utilities.
- `packages/forward-auth` – Runtime service that validates requests, issues decisions, and records audit/session events.
- `packages/sdk` – Public developer SDK that wraps contract ports with validation and ergonomic helpers.
- `packages/webhook-worker` – Dispatcher and worker responsible for webhook delivery retries and DLQ handling.
- `packages/*-memory` – In-memory reference adapters kept for unit tests and lightweight demos.
- `packages/middleware`, `packages/jwt-service`, `packages/token-service` – Supporting utilities for request handling and token workflows.
- Planning reports (`*_PLAN.md`, `*_REPORT.md`) – Context for how each domain evolved and the phased process expectations.

## Navigation Tips
- Start with `vision.md` to understand goals, pillars, and promised developer experiences.
- `arch-guide.md` documents the architectural rules (single-owner data, single responsibility, dependency injection) and the execution checklist (plan → execute → integrate).
- Each package has a `src/` directory with ports in `contracts` and adapters/services in subfolders. Tests live under `test/` using Node’s built-in runner.
- Data-layer work: inspect `packages/data-postgres/src/tables.ts` for canonical table names, `migrations/` for schema, `repositories/` for SQL, and `testing/` for the pg-mem harness.
- Runtime wiring: see `packages/forward-auth/src/postgres-runtime.ts` for how repositories are composed in production, and `packages/webhook-worker/src/index.ts` for worker bootstrapping.
- SDK entry point: `packages/sdk/src/index.ts` re-exports modules (`auth`, `profiles`, `entitlements`, `sessions`, `webhook-*`, etc.) that depend on injected stores.

## Coding Conventions
- Follow `arch-guide.md`: data has a single owner, files maintain single responsibility, and dependencies are injected (never imported directly from concrete implementations).
- Before coding a major feature, add a `*_PLAN.md` with phases limited to a single domain. Each phase should identify target files, completion criteria, and dependencies.
- Keep modules small and purpose-driven; extract helpers/services instead of growing large files.
- Use contract ports from `packages/contracts` to define boundaries; adapters implement these ports.
- Favor pure functions and immutability; repositories clone inputs/outputs to prevent mutation.
- Tests should run with `node --test` per package. Data-postgres harness uses pg-mem; forward-auth relies on stubbed repositories.
- TypeScript builds use project references: `node_modules/.bin/tsc -b packages/<name>/tsconfig.json`.

## Current Status (Postgres & Runtime)
- Postgres data plane ships repositories for profiles, memberships, entitlements, sessions, keys, audit logs, and webhook subscriptions/deliveries.
- Migrations seed the schema, with pg-mem-based tests covering CRUD, effective identity computation, and webhook registry flows.
- Forward-auth runtime consumes the Postgres data source; integration tests confirm session persistence and audit logging.
- SDK exposes modules for auth, profiles, orgs, keys, entitlements, sessions, webhooks, etc., backed by contract stores.
- Webhook worker package delivers dispatching, retry policies, signature helpers, and deterministic tests.

## Remaining V1 Tasks
1. **Headless UI & Embedded Admin Components**
   - Build Radix/Bits-UI compatible headless primitives for auth flows, profiles, memberships, keys, org management.
   - Compose embedded admin panels using those primitives and document usage.

2. **Forward-Auth Caching & Production Adapters**
   - Implement Redis (or alternative) cache/policy adapters and ensure Postgres mutations trigger cache invalidation for decision tokens and effective identities.
   - Add health checks, configuration docs, and telemetry hooks to the forward-auth service.

3. **Webhook Delivery Pipeline Hardening**
   - Connect the worker to actual queue infrastructure (e.g., Redis/BullMQ or another pluggable queue port).
   - Provide deployment guidance, metrics, and alerting around delivery retries and DLQ processing.

4. **Automation & MCP Tooling**
   - Implement MCP action adapters and reusable runbooks for provisioning Authentik resources.
   - Ship a CLI runner that executes runbooks with plan/apply flows.

5. **Documentation & Examples**
   - Publish developer docs (Docusaurus), quickstarts (Traefik, Next.js, Elysia), and cookbook scenarios aligned with the promised DX in `vision.md`.
   - Document environment setup, migration workflows, and ops runbooks.

6. **Observability & Security Hardening**
   - Integrate OpenTelemetry metrics/tracing, structured logging, and dashboards.
   - Define backup/restore strategies, retention policies for audit/webhook records, and review security baseline (TLS, rate limiting, secret rotation).

7. **Release Readiness**
   - Establish CI pipelines, package publishing workflows, and semantic versioning strategy.
   - Finalize licensing, contribution guidelines, and release notes for V1 launch.

## Getting Started
1. Install dependencies (`corepack enable`, `pnpm install`) when network access is available.
2. Run package builds/tests via TypeScript project references and Node’s test runner.
3. Inject real Postgres pools into services; tests use the pg-mem harness (`createTestPostgresDataSource`).
4. Follow planning checklist before new features, respecting architectural constraints.

This document captures the current state so future contributors can restart the conversation with full context.
