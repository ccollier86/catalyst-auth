# Quickstarts

The `examples/` directory contains forward-auth integration demos that showcase how to embed the UI
packages alongside the Catalyst SDK. Each example ships with README instructions for local
prototyping.

| Example | Stack | Highlights |
| --- | --- | --- |
| [`nextjs-forward-auth`](../../examples/nextjs-forward-auth/README.md) | Next.js App Router | Demonstrates server actions calling the Catalyst SDK and a client-side admin shell with TanStack Query hydration. |
| [`traefik-forward-auth`](../../examples/traefik-forward-auth/README.md) | Traefik reverse proxy + Next.js | Shows how to front a Traefik forward-auth middleware with Catalyst and render the admin shell behind authenticated routes. |
| [`elysia-forward-auth`](../../examples/elysia-forward-auth/README.md) | Elysia (Bun) + Vite SPA | Illustrates minimal Bun server wiring and consumption of the headless primitives within a Vite-powered dashboard. |

To explore the UI components in isolation, run Storybook within each package:

```bash
pnpm --filter @catalyst-auth/ui-headless storybook
pnpm --filter @catalyst-auth/ui-admin storybook
```
