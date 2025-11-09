# Profile Memory Tests Plan

## Goal
Add a `node:test` suite that exercises the in-memory profile store adapter against its built output to validate core behaviors: CRUD operations, label merging, membership resolution, and error handling.

## Scope & Phases

### Phase 1: Test Harness Setup
- Create `packages/profile-memory/test/` with a test file targeting the dist build.
- Ensure the package `test` script links workspace packages via `scripts/link-workspace-packages.mjs` before running the suite.
- Import from the compiled `dist` output to mirror consumer usage.

### Phase 2: Behavior Coverage
- Write tests covering:
  - User/org/group/membership upsert and retrieval semantics (cloning, indexes).
  - Slug lookup and membership listing by user/org.
  - Group deletion removing group references and ensuring deduped group IDs.
  - Effective identity computation, including label merging, optional group inclusion, membership selection by id/org, and error cases when entities missing or mismatched.

## Completion Criteria
- `node --test` suite passes against built artifacts.
- No production code changes outside of tests/package wiring.
- Plan document updated only if deviations occur (none expected).
