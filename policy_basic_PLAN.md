# Basic Policy Engine Plan

## Vision Alignment

Deliver a configurable policy engine that satisfies the `PolicyEnginePort` and empowers forward-auth handlers, SDK middleware, and admin tooling to enforce Catalyst label, role, and scope requirements without waiting on the full RBAC service. The implementation should offer deterministic rule evaluation with deny-first semantics while remaining framework agnostic.

## Phases

### Phase 1: Package Scaffolding
- Create the `packages/policy-basic` workspace package with `package.json`, `tsconfig.json`, and initial `src/index.ts` wired to the shared TypeScript base config.
- Ensure the package exposes its build artifacts and depends on `@catalyst-auth/contracts`.
- Confirm the pnpm workspace already captures `packages/*` and no additional registration is required.

**Completion Criteria**
- Package builds with `tsc --build` via project references.
- Entry point re-exports the policy engine factory/class.

### Phase 2: Policy Engine Implementation
- Implement a rule-driven policy engine honoring labels, roles, scopes, entitlements, groups, and optional environment constraints from the effective identity context.
- Support wildcard matching for actions/resource descriptors and allow rule-specific obligations, decision JWT hooks, and deny precedence.
- Provide a helper factory alongside the class to simplify instantiation in other packages.

**Completion Criteria**
- TypeScript compiler reports no errors for the new package.
- Policy evaluation returns `Result` values with deterministic deny-before-allow behavior and a default deny decision when no rule applies.

## Out of Scope
- Persistence of rules beyond in-memory configuration.
- Advanced RBAC graph traversal or external authorization services.
- Telemetry, metrics, or audit logging integration.

## Risks & Mitigations
- **Risk:** Misordered rules causing unintended allow decisions. **Mitigation:** Enforce deny precedence during evaluation and document default behavior.
- **Risk:** Mutable obligation objects leaking to callers. **Mitigation:** Clone rule artifacts before returning decisions.
- **Risk:** Ambiguous wildcard handling. **Mitigation:** Normalize patterns to explicit regular expressions and cover `*` semantics consistently for actions and resources.
