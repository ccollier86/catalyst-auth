# Catalyst MCP Automation Runner

The Catalyst MCP runner provides idempotent automation for Authentik resources. Runbooks
express the desired Authentik state as a sequence of strongly typed actions. The runner
computes a plan describing the required CRUD operations and can apply the plan while
recording state in Postgres for convergence tracking.

## Runbook anatomy

Runbooks live in JSON or YAML files and adhere to the contracts defined in
`@catalyst-auth/contracts/mcp`. Each runbook declares a name, version, and an ordered set of
actions. Every action receives a stable `id` that is used to track dependencies and state
history. The two Authentik actions currently supported are:

- `authentik.ensure` — creates or updates a resource until it matches the provided spec.
- `authentik.delete` — removes a resource if it exists.

```yaml
name: example
version: "1.0.0"
actions:
  - id: ensure-provider
    kind: authentik.ensure
    name: Ensure identity provider
    spec:
      kind: provider
      id: provider-1
      properties:
        name: Example Provider
        url: https://idp.example.test
  - id: cleanup-legacy
    kind: authentik.delete
    name: Remove legacy application
    dependsOn: [ensure-provider]
    selector:
      kind: application
      id: legacy-app
```

## CLI usage

Install dependencies with `pnpm install` and build the packages as needed. The runner ships
with a CLI entry point that supports `plan` and `apply` subcommands. An Authentik client is
dependency-injected via a module that exports `createAuthentikClient` and returns an
`AuthentikResourcePort`. This factory can leverage `@catalyst-auth/sdk` to construct real
Authentik adapters.

```bash
pnpm catalyst-mcp plan ./runbook.yaml \
  --database-url postgresql://localhost/mcp \
  --client-module ./scripts/authentik-client.js
```

The CLI enforces dry-run semantics for `apply` unless the `--execute` flag is provided:

```bash
pnpm catalyst-mcp apply ./runbook.yaml \
  --database-url postgresql://localhost/mcp \
  --client-module ./scripts/authentik-client.js \
  --execute
```

Use `--format json` to emit machine-readable output. Plans include diff sections describing
the before/after payload for each action. Apply results note whether an action was applied,
skipped (due to dry-run or dependency failures), or failed.

## Testing with pg-mem

Integration tests for the runner live in `packages/mcp-runner/test`. They rely on `pg-mem`
to emulate Postgres and inject a fake Authentik client. This harness exercises the full
plan/apply lifecycle, verifying convergence and the dry-run guard without requiring external
infrastructure.
