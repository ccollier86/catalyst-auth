# In-Memory Cache Adapter Plan

## Vision Alignment

Provide a default in-memory cache adapter that satisfies the `CachePort` contract so higher layers can rely on a concrete implementation during development and tests. The adapter must offer namespaced key storage with TTL support and predictable eviction semantics without external dependencies.

## Phases

### Phase 1: Package Scaffolding
- Create the `packages/cache-memory` workspace package with its own `package.json` and `tsconfig.json` referencing the root config.
- Expose build scripts consistent with existing packages.
- Add the package to the workspace entrypoints.

**Completion Criteria**
- Package recognized by pnpm workspace configuration.
- TypeScript build succeeds via project references.

### Phase 2: Cache Implementation
- Implement an in-memory cache class that satisfies the `CachePort` interface.
- Support `get`, `set`, `delete`, and `clear` semantics with optional TTL handling per entry.
- Provide utility helpers for time management and eviction cleanup.
- Export the cache implementation via the package entrypoint.

**Completion Criteria**
- TypeScript compiler reports no errors.
- Cache behavior aligns with `CachePort` expectations (namespaced keys, TTL expiration, manual invalidation).

## Out of Scope
- Persistent cache adapters (Redis, etc.).
- Metrics or instrumentation hooks.
- Integration with other packages beyond exports.

## Risks & Mitigations
- **Risk:** Memory leaks due to lingering timeouts. **Mitigation:** Track expirations with a min-heap-like map and clear timers when entries expire or are deleted.
- **Risk:** Clock drift affecting TTL accuracy. **Mitigation:** Base comparisons on `Date.now()` at use-time without long-lived intervals.
