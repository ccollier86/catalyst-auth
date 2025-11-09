# In-Memory Profile Store Plan

## Vision Alignment

Deliver an in-memory implementation of the `ProfileStorePort` so that higher-level services can iterate on identity flows without waiting on the Postgres overlay. This adapter will persist user, org, membership, and group records in process memory and produce effective identities with deterministic label merging consistent with the architecture vision.

## Phases

### Phase 1: Package Scaffolding
- Create the `packages/profile-memory` workspace package with its own `package.json` and `tsconfig.json` referencing the shared base config.
- Export the public API via `src/index.ts` and ensure the package depends on `@catalyst-auth/contracts`.
- Register the package in the pnpm workspace configuration if required.

**Completion Criteria**
- Package builds with `tsc --build` using project references.
- Entry point re-exports the in-memory store factory/class.

### Phase 2: Store Implementation
- Implement an in-memory profile store that satisfies every method in `ProfileStorePort`.
- Support deterministic storage via Maps keyed by record ID/slug and keep indexes for lookups (e.g., slug → org ID).
- Provide helpers for merging label sets and normalizing optional arrays (roles, entitlements, scopes) during effective identity computation.
- Ensure `computeEffectiveIdentity` merges labels in the order: user → org → membership → groups and deduplicates groups while respecting inclusion flags.

**Completion Criteria**
- TypeScript compiler reports no errors.
- Methods return cloned data to avoid external mutation of internal state.
- Effective identity output aligns with label merge expectations and includes stable ordering for groups/roles/scopes.

## Out of Scope
- Persistent storage adapters (Postgres, external services).
- Advanced RBAC or entitlement resolution beyond merging static arrays from records.
- Concurrency controls beyond standard JS single-threaded safety.

## Risks & Mitigations
- **Risk:** External callers mutating returned objects. **Mitigation:** Return deep clones or frozen copies from getters/listing methods.
- **Risk:** Label merge precedence confusion. **Mitigation:** Document and centralize merge order in helper utilities with tests-ready deterministic sequencing.
- **Risk:** Accidental mutation of membership/group arrays. **Mitigation:** Always copy arrays before storing and when returning data.
