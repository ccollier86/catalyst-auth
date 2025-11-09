# Authentik Client Test Plan

## Goals
- Exercise the Authentik adapter against representative success and failure paths.
- Ensure requests are constructed with expected payloads/headers and responses are mapped correctly.
- Validate effective identity assembly, including group merging and fallback logic.

## Coverage
1. Authorization code exchange:
   - Verifies URL-encoded body fields (code, verifier, redirect, scopes, client secret) and token mapping.
2. Effective identity assembly:
   - Successful profile + session fetch with API group merge.
   - Graceful fallback to profile-derived groups when group lookup returns 404.
3. Token introspection:
   - Maps introspection claims and expiry.
4. Admin token provider errors:
   - Returns infra error when provider yields empty token.

## Out of scope
- Network retry policies (handled by higher layers).
- Exhaustive mapping of every Authentik payload variant.

## Test harness
- node:test with bespoke fetch stub to queue responses by method + URL.
- Deterministic clock stub for expiry assertions.

## Completion criteria
- Tests pass against the built dist output (`tsc -b`).
- Package test script wired to run linker helper then node:test suite.
