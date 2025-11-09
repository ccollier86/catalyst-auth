# Forward Auth Fetch Handler Plan

## Goal
Expose a fetch-compatible forward auth handler that adapts Traefik forward-auth requests into the `ForwardAuthService` domain, returning proper HTTP responses with headers for decision caching.

## Phases

### Phase 1 – Types & Config wiring
- Introduce handler-specific option types in `packages/forward-auth/src/types.ts` (fetch handler options, derived request context).
- Ensure exports include the new types for consumers.
- Completion: Types compile without breaking existing builds.

### Phase 2 – Handler implementation
- Add `packages/forward-auth/src/forward-auth-fetch-handler.ts` implementing `createForwardAuthFetchHandler`.
- Normalize headers, derive method/path/orgId/environment, call `ForwardAuthService`, and return `Response`.
- Provide sensible defaults for Traefik headers and environment prefix.
- Completion: Handler compiles and is exported via package entrypoint.

### Phase 3 – Tests
- Add node:test coverage under `packages/forward-auth/test` validating:
  - Basic authorization pass-through using forwarded headers.
  - Environment prefix parsing and override behaviour.
  - Decision JWT cache reuse via Authorization: Decision header.
  - Error propagation for missing credentials.
- Completion: Tests pass against the built package using existing workflow.

## Risks & Mitigations
- **Header casing mismatch** → Always lowercase when reading; include tests.
- **Missing fetch Response in environment** → Node 18+ provides; ensure tests run under Node fetch.
- **Decision JWT caching semantics** → Reuse existing service `handle` logic and tests to avoid duplication.

## Out of scope
- No HTTP server creation beyond fetch-compatible handler.
- No changes to Traefik snippets or SDK utilities.
