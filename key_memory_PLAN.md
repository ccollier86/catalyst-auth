# Key Memory Adapter Plan

## Objective
Introduce in-memory storage for Catalyst API keys that satisfies a new key-store port within the shared contracts package. The adapter should support key issuance, lookup by id/hash, owner-scoped listing, status transitions (active, expired, revoked), and usage tracking timestamps. It must enforce immutability of stored data when returned to callers.

## Phases

### Phase 1: Contracts – Key Domain & Port
- Add domain types describing API key ownership, metadata, and lifecycle fields.
- Define `KeyStorePort` with issuance, retrieval (by id/hash), listing, usage tracking, and revocation methods returning `Result`/`DomainError`.
- Export the new types/port from the contracts entrypoint.

**Completion criteria**
- TypeScript build for contracts succeeds.
- New types align with existing error/result helpers.
- No other packages referenced yet.

### Phase 2: Adapter – In-Memory Implementation
- Scaffold `@catalyst-auth/key-memory` package with build config and exports wired to contracts.
- Implement `MemoryKeyStore` that clones payloads, manages maps for ids/hashes, enforces uniqueness, and dynamically computes expiration state.
- Support injecting clock/id factories, handle revocation metadata, and expose a factory helper similar to other memory adapters.

**Completion criteria**
- Package builds via `tsc -b` using workspace references.
- Implementation satisfies `KeyStorePort` and maintains immutability of exposed objects.

### Phase 3: Tests – Memory Key Store Behavior
- Add `node:test` coverage for issuance, hash lookup, expiration evaluation, owner listings, usage tracking, and revocation flows (including double-revoke guard).
- Ensure tests exercise the dist build using the workspace linking script.

**Completion criteria**
- Tests pass via `node --test` after linking workspace packages.
- Coverage demonstrates error handling for duplicates or unknown keys.
