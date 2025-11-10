# Contributing to Catalyst Auth

Thanks for investing time in improving Catalyst Auth! This guide covers local development, testing, and release
expectations.

## Getting started

1. Install dependencies with `pnpm install`.
2. Run `pnpm build` to compile all workspace packages.
3. Execute `pnpm test` to validate unit tests.
4. `pnpm lint` runs formatter/lint placeholders. Extend per package when new lint rules are added.

## Development workflow

- New packages should depend on the shared telemetry helpers in `@catalyst-auth/telemetry`.
- Keep architecture notes under `docs/architecture/` up to date alongside code changes.
- Update relevant runbooks or setup guides when operational behavior changes.

## Commit conventions

Catalyst Auth uses [Conventional Commits](https://www.conventionalcommits.org/) so semantic-release can
calculate versions automatically. Example: `feat(sdk): add tracing to entitlements module`.

## Testing & CI

- The CI workflow runs lint, test, build, and docs build.
- Add package-specific tests under `packages/<name>/test` and wire into the local `pnpm test` script.
- For telemetry changes, validate metrics and spans manually using an OpenTelemetry collector.

## Releases

Releases are automated through semantic-release:

1. Merge changes into `main` with conventional commit messages.
2. The `Release` workflow runs on pushes to `main` and will publish npm packages and container images when
   credentials are available.
3. Use `pnpm release:dry-run` locally to preview version bumps and changelog entries.

## Community guidelines

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) if provided.
- Prefer discussions in issues/PRs so decisions are discoverable.
- Reviewers should confirm telemetry, docs, and runbooks are updated for impactful changes.
