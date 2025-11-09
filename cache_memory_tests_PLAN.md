# Memory Cache Test Plan

## Goal
Add a `node:test` suite that exercises the in-memory cache adapter to ensure TTL expiration, tag invalidation, and clearing semantics behave as expected for downstream consumers.

## Phases

### Phase 1 – Test Harness Setup
- Create a `test` directory under `packages/cache-memory` with workspace linking script usage mirroring other packages.
- Add a Node.js test entry that imports the built outputs from `dist/` via the workspace linker for consistent resolution.

### Phase 2 – Core Behavior Tests
- Cover cache hit/miss, overwriting entries, TTL expiration using an injected clock, tag-based purges, and global clear semantics.
- Verify that expired items are evicted lazily on access and by timer callbacks.

## Completion Criteria
- `node --test` suite passes for the cache package.
- No production source changes besides optional testing utilities.
- Workspace scripts remain aligned with existing packages.
