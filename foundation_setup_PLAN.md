# Foundation Setup Plan

## Vision Alignment

Establish the initial Catalyst-Auth TypeScript workspace following the SOR/SOD/DI principles and create the foundational contracts that future adapters and services will implement. This phase focuses on tooling and interface definitions only.

## Phases

### Phase 1: Workspace & Tooling
- Create repository-wide `.gitignore` for Node/TypeScript projects.
- Define root `package.json` configured for pnpm with shared scripts.
- Add `pnpm-workspace.yaml` covering packages under `packages/*`.
- Establish base TypeScript configuration (`tsconfig.base.json`).

**Completion Criteria**
- pnpm workspace recognized.
- TypeScript compiler can resolve shared config.
- No package-specific code yet.

### Phase 2: Contracts Package Skeleton
- Create `packages/contracts` workspace package with its own `package.json` and `tsconfig.json` referencing the base config.
- Implement contract interfaces for cache, profile store, policy engine, webhook delivery, and IdP adapter ports.
- Provide shared domain types (e.g., `Result`, `DomainError`, `EffectiveIdentity`).
- Export contracts through package entrypoint.

**Completion Criteria**
- Contracts compile with `tsc --build`.
- Interfaces reflect architecture vision and are dependency-free.

## Out of Scope
- Concrete implementations (adapters/services).
- SDK/UI components.
- Tests beyond ensuring TypeScript compilation succeeds.

## Risks & Mitigations
- **Risk:** Interface drift from future requirements. **Mitigation:** Keep interfaces minimal and focused on immediate architectural needs.
- **Risk:** Workspace misconfiguration. **Mitigation:** Use TypeScript project references and verify `tsc --build` succeeds once code exists.

