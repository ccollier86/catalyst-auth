# Key Memory Adapter Test Plan

## Goals
Verify the in-memory key store fulfills the `KeyStorePort` contract by covering issuance, retrieval, listing filters, usage tracking, revocation, and immutability semantics.

## Coverage
- Issuance succeeds with auto-generated ids and duplicate guards for both id and hash.
- Retrieval by id/hash returns cloned records and reflects expiration state.
- Owner listings respect inclusion flags for revoked/expired keys and remain isolated per owner.
- Usage tracking increments counters, updates timestamps, and rejects revoked/expired keys.
- Revocation populates metadata, blocks subsequent revocations/usages, and preserves immutability of previous snapshots.
- Initialization with `initialKeys` seeds lookup maps correctly.

## Out of Scope
- Cryptographic validation of hashes or secrets.
- Budget/quota enforcement beyond usage count increments.

## Tooling
- `node:test` with the workspace linker to execute against the build output.
