# Postgres Data Source Completion Plan

## Objective
Replace the in-memory placeholder that currently powers `@catalyst-auth/data-postgres` with a production-ready Postgres implementation that honors the existing contracts (profiles, memberships, keys, audit logging) while remaining testable without a live database.

## Phases

### Phase 1: SQL Core & Data Source Wiring
- Introduce a `QueryExecutor` abstraction with a concrete `PgQueryExecutor` backed by `pg.Pool`.
- Update the Postgres data source factory to depend on the executor instead of the in-memory harness and expose a transaction manager that executes real SQL transactions.
- Retire the in-memory database export and adjust seed/test utilities to work against the new abstraction.

**Completion criteria**
- New executor types compile and expose `query` + transaction helpers.
- Data source factory accepts either an executor or a `pg.Pool` and no longer references the in-memory database.
- Transaction manager begins/commits/rolls back SQL transactions.

### Phase 2: Key Store Repository Rewrite
- Re-implement the key store using SQL (`INSERT ... RETURNING`, `SELECT`, `UPDATE`) executed via the executor abstraction.
- Preserve duplicate detection, status resolution (revoked/expired), and metadata cloning semantics.
- Cover issuance, lookup, listing, usage recording, and revocation paths with node:test suites that assert SQL shape and domain mapping via a recording executor stub.

**Completion criteria**
- All key store methods issue the expected SQL and map rows into immutable `KeyRecord` objects.
- Duplicate constraint and not-found errors return structured `CatalystError` codes.
- Tests verify SQL statements and domain results without requiring Postgres.

### Phase 3: Profile & Membership Repository Rewrite
- Replace the in-memory profile store with SQL backed methods for users, orgs, groups, and memberships.
- Implement `computeEffectiveIdentity` by combining SQL lookups (user, membership, org, groups) and merging label sets.
- Add node:test coverage for representative flows (user/org upsert, membership listing, effective identity resolution) via the recording executor.

**Completion criteria**
- Profile store calls only use the executor abstraction and return cloned records.
- Identity computation enforces error conditions (missing user/org/membership mismatches).
- Tests assert SQL statements and merged labels/groups.

### Phase 4: Audit Log Repository Rewrite & Seed Utilities
- Rebuild the audit log repository using SQL `INSERT`/`SELECT` queries with validation and structured errors.
- Update seed utilities and test helpers to operate through repositories/executors rather than the old in-memory collections.
- Provide fixtures/stubs to simplify unit testing for downstream packages.

**Completion criteria**
- Audit log methods execute SQL via the executor and maintain ordering guarantees.
- Seed helper inserts records through repositories (or batched SQL) and remains deterministic.
- All new tests pass under `pnpm --filter @catalyst-auth/data-postgres test`.
