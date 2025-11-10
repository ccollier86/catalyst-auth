# `@catalyst-auth/ui-admin`

The admin package composes the headless primitives into a batteries-included management experience.
It configures TanStack Query caches, React Router wiring, accessibility defaults, and consumable
theme tokens. Persistence is delegated to injected Catalyst SDK clients.

## Shell architecture

- `AdminShell` accepts Catalyst SDK clients and wires them into context providers.
- `createAdminRouter` returns a browser router with dashboard, organisation, and key routes.
- `useAdminQueries` exposes strongly-typed query and mutation hooks powered by TanStack Query.
- `adminTokens` exports spacing, colour, and typography scales for embedding into host design systems.

## Accessibility

Storybook stories include the a11y addon and automated `jest-axe` checks. The built-in views rely on
semantic HTML (e.g. table headers, labelled forms) so that screen readers announce intent and status.

## Extending the shell

Provide custom `routes` or a fully-configured `router` to `AdminShell` to replace or augment the
default screens. The exported views (`DashboardView`, `OrganisationsView`, `KeysView`) can be used as
reference implementations or embedded directly when you need a fast starting point.
