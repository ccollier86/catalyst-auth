# @catalyst-auth/ui-headless

Headless React primitives that orchestrate Catalyst Auth flows. Each primitive accepts
an injected SDK client so that state management remains framework agnostic while allowing
applications to compose with their preferred visual components (Radix UI, custom design
systems, etc.).

## Included primitives

- **AuthDialogPrimitive** – handles email-first sign-in flows and mirrors the Radix `Dialog`
  contract through `open` and `setOpen` controls.
- **MembershipPrimitive** – coordinates organisation discovery, creation, and context switching.
- **KeyManagementPrimitive** – presents a renderless API for managing signing keys.

Refer to the Storybook located in `.storybook` for exhaustive examples and accessibility
notes.
