# `@catalyst-auth/ui-headless`

`@catalyst-auth/ui-headless` exposes Radix-friendly renderless components that orchestrate Catalyst
Auth flows with injected SDK clients. Each primitive renders nothing by default and instead forwards
state and actions through a render-prop callback so consumers can compose their own UI controls.

## Primitives

| Primitive | Responsibilities | Key props |
| --- | --- | --- |
| `AuthDialogPrimitive` | Email-first authentication flows. Mirrors Radix `Dialog` contracts with `open`/`setOpen` controls. | `client`, `defaultOpen`, `children(state, actions)` |
| `MembershipPrimitive` | Organisation listing, creation, and switching. | `client`, `initialOrganisationId`, `children(state, actions)` |
| `KeyManagementPrimitive` | Signing-key inventory, creation, and revocation. | `client`, `children(state, actions)` |

The injected client contracts are defined in [`src/clients.ts`](../../packages/ui-headless/src/clients.ts).
They map one-to-one with the Catalyst SDK but remain framework agnostic so they can be backed by
REST, GraphQL, or mocked transports.

## State contracts

Each primitive surfaces a fully-typed state object that captures loading flags, error messages, and
active resource identifiers. Refer to the TypeScript definitions in the `src/` directory or open the
Storybook (`pnpm --filter @catalyst-auth/ui-headless storybook`) to inspect props and state visually.

## Testing & accessibility

Vitest + Testing Library suites assert data flows while `jest-axe` is used to verify generated DOM
remains accessible when paired with sample Radix components. Use these tests as a template when
integrating the primitives with your own design system.
