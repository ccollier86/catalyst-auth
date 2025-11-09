# Forward Auth Postgres Integration Plan

## Objective
Wire the forward-auth service to the new Postgres data source so production deployments persist audit and session activity while keeping the service testable with injected adapters.

## Phases

### Phase 1 – Service contract updates
- Extend `ForwardAuthConfig` to accept a `SessionStorePort`.
- Update `ForwardAuthService` to upsert session activity via the injected store without breaking existing consumers.
- Completion: TypeScript builds with the new config shape.

### Phase 2 – Postgres runtime factory
- Add a runtime helper under `packages/forward-auth` that composes `createPostgresDataSource` with `ForwardAuthService` so callers can bootstrap the service with a `pg` pool.
- Ensure exports expose the helper and type definitions.
- Completion: Runtime factory compiles and returns `{ service, dataSource }` for use by handlers.

### Phase 3 – Tests & docs
- Add node:test coverage proving session persistence and the runtime helper work against the pg-mem harness.
- Document the new configuration in the forward-auth README so operators know how to enable Postgres persistence.
- Completion: Tests pass (modulo offline package installation) and README reflects the new helper.
