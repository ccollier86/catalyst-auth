# Data Postgres Adapter Plan

## Objective
Establish a Postgres-backed data layer that replaces in-memory adapters beginning with durable API key storage. The adapter must satisfy the shared `KeyStorePort`, leverage dependency injection for query execution, and translate database rows into immutable domain records while preserving error semantics for duplicates, revocation, and usage tracking.

## Phases

### Phase 1: Package Scaffold & Query Contracts
- Create the `@catalyst-auth/data-postgres` workspace package with build config, exports, and shared query interfaces.
- Define injectable query executor abstractions plus clock/id hooks required by Postgres-backed repositories.
- Ensure lint/build wiring mirrors existing adapter packages.

**Completion criteria**
- Package builds via `tsc -b` against shared contracts.
- Query abstraction types compile without external dependencies (e.g., `pg`).

### Phase 2: Postgres Key Store Implementation
- Implement `PostgresKeyStore` satisfying `KeyStorePort` using SQL statements targeting a configurable keys table (default `catalyst_keys`).
- Handle issuance, lookup, owner-scoped listing, usage tracking, and revocation with domain-aware error mapping (duplicate id/hash, revoked/expired guards, not-found cases).
- Provide helpers for cloning JSON payloads, deduplicating scopes, and computing expiration state based on timestamps.

**Completion criteria**
- Implementation compiles, injecting dependencies via constructor/factory.
- No mutable references leak to callers.
- Errors return structured `CatalystError` objects with stable codes.

### Phase 3: Tests – Postgres Key Store SQL & Behavior
- Add `node:test` suite with a stub query executor that records SQL/parameters and returns canned rows to simulate Postgres interactions.
- Cover issuance success and duplicate failure paths, hash/id lookups, listing filters (`includeRevoked`/`includeExpired`), usage tracking guards, and revocation state transitions.
- Verify SQL commands target the expected table and propagate timestamps/metadata correctly.

**Completion criteria**
- Workspace linking script runs before tests, which pass via `node --test`.
- Recorded SQL assertions demonstrate correct parameter ordering and filtering logic.
