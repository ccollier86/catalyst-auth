# Postgres Integration Audit Report

## Summary
- The `@catalyst-auth/data-postgres` package exists on `main`, but every exported repository still runs entirely against the in-memory harness (`InMemoryPostgresDatabase`). There is no SQL executor abstraction, query builder, or runtime Postgres wiring yet. 【F:packages/data-postgres/src/postgres-data-source.ts†L3-L31】【F:packages/data-postgres/src/repositories/key-repository.ts†L19-L273】
- Forward-auth only consumes the Postgres data source inside tests; production wiring continues to rely on in-memory adapters, so the Postgres layer is not exercised by default. 【F:packages/forward-auth/test/forward-auth-service.test.js†L1-L118】
- Migrations declare tables for profiles, memberships, entitlements, sessions, keys, and audit events, but repositories currently bypass SQL entirely, so none of those tables are used. 【F:packages/data-postgres/src/migrations/0001_initial.sql†L1-L69】
- No Node test harness exists for SQL assertions—the package only exposes the in-memory database plus seeding helpers. 【F:packages/data-postgres/src/testing/test-data-source.ts†L1-L23】
- Workspace plumbing is partial: `pnpm-workspace.yaml` includes the package through the glob, but `tsconfig.base.json` lacks a path alias for `@catalyst-auth/data-postgres`, and there is no configuration to select Postgres adapters in production services. 【F:tsconfig.base.json†L19-L48】

## Preparation Notes
- `pnpm sort:paths` failed because the environment cannot reach the npm registry, so the existing path ordering is untouched. (Command: `pnpm sort:paths` – network blocked.)
- No remote named `origin` is configured, so the local branch already reflects the checked-in `main` state.

## Repository Inventory
- Workspace packages: `authentik-client`, `cache-memory`, `contracts`, `data-postgres`, `forward-auth`, `jwt-service`, `key-memory`, `middleware`, `policy-basic`, `profile-memory`, `sdk`, `token-service`, `webhook-memory`. Only one Postgres-specific package (`data-postgres`) is present; there are no duplicate scaffolds. 【F:packages/data-postgres/src/index.ts†L1-L10】
- `pnpm-workspace.yaml` covers every package via the `packages/*` glob, so the Postgres package is part of the workspace. 【F:pnpm-workspace.yaml†L1-L2】
- `tsconfig.base.json` is missing a path alias for `@catalyst-auth/data-postgres`, preventing type-safe imports outside of relative paths.

## Contracts Alignment
- `KeyStorePort`, `ProfileStorePort`, and `AuditLogPort` remain generic; there are no Postgres-specific extensions in `packages/contracts`. The current in-memory implementations in `data-postgres` conform to those ports, so we can replace them with SQL-backed repositories without changing contracts. 【F:packages/contracts/src/ports/keys/key-store-port.ts†L1-L20】

## Deep-Dive Findings
### Schema & Migrations
- `0001_initial.sql` defines tables for users, orgs, groups, memberships, entitlements, sessions, keys, and audit events, matching the roadmap coverage. However, there are no migration runners or integration points to execute the SQL, and the repositories never read/write through SQL. 【F:packages/data-postgres/src/migrations/0001_initial.sql†L1-L69】

### Repository Implementations
- `PostgresKeyStore`, `PostgresProfileStore`, and `PostgresAuditLog` all wrap `InMemoryPostgresDatabase` maps; they do not accept a query executor or translate between rows and records. Error codes and result semantics mimic the in-memory behavior but are not Postgres-aware (e.g., duplicate detection relies on maps rather than SQL constraints). 【F:packages/data-postgres/src/repositories/key-repository.ts†L19-L273】【F:packages/data-postgres/src/repositories/profile-repository.ts†L1-L214】【F:packages/data-postgres/src/repositories/audit-repository.ts†L1-L76】
- `PostgresTransactionManager` is a stub that simply invokes the callback without transaction semantics. 【F:packages/data-postgres/src/transactions/transaction-manager.ts†L1-L12】

### Test Harness
- No `node:test` suites exist for SQL shape verification; the test helpers simply expose the in-memory database for other packages. 【F:packages/data-postgres/src/testing/test-data-source.ts†L1-L23】

### Integration Points
- `createPostgresDataSource` wires repositories with the in-memory database and is only consumed from forward-auth tests. There is no production configuration that selects Postgres implementations for real services. 【F:packages/data-postgres/src/postgres-data-source.ts†L3-L31】【F:packages/forward-auth/test/forward-auth-service.test.js†L1-L118】

## Gap Analysis
1. **SQL Execution Layer Missing** – Need a query executor abstraction and concrete Postgres client wiring; repositories must emit SQL instead of mutating the in-memory harness.
2. **Repository Coverage Gaps** – Only keys, profiles, memberships, and audit logs have placeholder implementations. Sessions, entitlements, and webhook registry repositories are absent.
3. **Migrations Unsourced** – Schema SQL exists but lacks migration tooling, versioning metadata, and automation in CI/deployment.
4. **Testing Deficit** – No SQL-focused unit or integration tests for repositories; existing forward-auth tests rely on the in-memory harness, so we gain no confidence in SQL behavior.
5. **Forward-Auth & SDK Wiring** – Services still depend on memory adapters; no dependency injection configuration selects Postgres for production paths, so downstream features cannot leverage durability.
6. **Observability & Ops** – No migration runner, health checks, metrics, or backup/restore documentation for operating Postgres.

## Sequenced Roadmap
### Phase 1 – Postgres Foundations
1. Add `@catalyst-auth/data-postgres` path alias to `tsconfig.base.json` and ensure build references resolve.
2. Introduce a query executor interface (`SqlExecutor`) with support for parameterized queries and typed result decoding.
3. Implement a node-postgres (or pg-promise) adapter behind the executor; provide dependency injection hooks so repositories never import `pg` directly.
4. Replace `InMemoryPostgresDatabase` usage inside repositories with SQL-based implementations while preserving contract semantics and error codes.
5. Build a lightweight migration runner (e.g., `scripts/migrate-postgres.ts`) that executes `postgresMigrations` with idempotent tracking.

### Phase 2 – Key Store Completion
1. Implement SQL statements for issuing, fetching, listing, usage tracking, and revocation in `PostgresKeyStore`.
2. Normalize duplicate key/hash errors by catching constraint violations and mapping them to Catalyst error codes.
3. Add `node:test` suites with a stub executor to assert SQL text, parameter order, and error translation.
4. Provide integration tests against a temporary Postgres instance (or docker-mocked) when environment allows; otherwise rely on stub plus contract tests.

### Phase 3 – Profile & Membership Repositories
1. Translate profile, org, group, and membership operations into SQL queries aligned with `auth_users`, `auth_orgs`, `auth_groups`, and `auth_memberships` tables.
2. Implement entitlements repository covering `auth_entitlements` plus derived queries for effective identity.
3. Extend transaction manager to wrap multi-step operations within transactions (e.g., membership updates touching entitlements).
4. Cover all operations with `node:test` suites using stub executor plus scenario tests.

### Phase 4 – Sessions & Audit
1. Implement session store (issuance, rotation, revocation, last-seen updates) backed by `auth_sessions`.
2. Expand audit log to write/read via SQL with appropriate indexes and ordering.
3. Add tests for session expiration, concurrency, and audit retrieval ordering.

### Phase 5 – Forward-Auth & SDK Integration
1. Update forward-auth configuration to inject the Postgres-backed key store and audit log in production builds while retaining in-memory adapters for tests.
2. Ensure decision caching and audit logging persist to Postgres; add integration tests verifying persisted records.
3. Expose Postgres data source through the SDK so UI and CLI layers can consume durable APIs.
4. Document environment variables and DI wiring for selecting Postgres in deployment.

### Phase 6 – Webhook Registry & Worker Pipeline
1. Add tables and repositories for webhook subscriptions, deliveries, and retry state.
2. Implement queue-backed worker (e.g., using BullMQ or custom runner) that consumes delivery jobs, tracks attempts, and escalates to DLQ.
3. Provide API/SDK wiring for managing webhooks and reporting delivery outcomes.

### Phase 7 – Automation & MCP Tooling
1. Scaffold MCP action adapters that invoke SDK operations for provisioning flows.
2. Ship reusable runbooks plus a CLI runner that orchestrates MCP workflows against the Postgres-backed data layer.

### Phase 8 – Headless UI & Embedded Admin
1. Build headless primitives (Radix/Bits-UI) for auth flows, profiles, keys, org management, and sessions using SDK hooks that talk to Postgres.
2. Assemble composable admin panels using those primitives; ensure they integrate with webhook registry configuration and audit views.

### Phase 9 – Production Adapters & Observability
1. Deliver production-grade cache adapters (Redis), policy engines, and any remaining infrastructure connectors.
2. Add observability (metrics, logging, tracing), health checks for Postgres, migration status endpoints, and backup/restore documentation.
3. Harden security (least-privilege database roles, secrets management, TLS requirements).

## Immediate Follow-Up Tasks
1. **Normalize Tooling** – Add missing TypeScript path alias and ensure workspace scripts reference Postgres package.
2. **Design SQL Executor API** – Draft interface and stub implementation for repository injection.
3. **Author Key Store SQL Plan** – Document expected statements, error mapping, and transaction usage before coding.
4. **Stand Up Test Harness** – Create stub executor recorder plus (optional) Docker-backed Postgres for integration testing.
5. **Plan Migration Runner & Ops** – Define migration metadata storage, CLI, and deployment checklist.

Completing these tasks will unlock the remaining roadmap phases and allow the team to progress from in-memory shims to a production-ready Postgres data plane that supports the broader Catalyst Auth vision (forward-auth, headless UI, webhook pipeline, automation tooling, and observability).
