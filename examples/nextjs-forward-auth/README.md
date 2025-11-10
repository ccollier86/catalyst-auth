# Next.js forward-auth demo

A minimal Next.js App Router project that wires the Catalyst SDK with the UI packages. The example
focuses on showcasing how to hydrate TanStack Query caches server-side and how to embed the admin
shell as part of a protected route.

## Getting started

```bash
pnpm install
pnpm dev
```

The `app/(admin)/admin/page.tsx` route consumes `@catalyst-auth/ui-admin` while the app layout wires a
custom Catalyst SDK client into the React context. API routes under `app/api/auth` proxy forward-auth
calls to the Catalyst service.

## Key files

- [`app/providers.tsx`](./app/providers.tsx) – supplies the SDK clients to the UI packages.
- [`app/(admin)/admin/page.tsx`](./app/(admin)/admin/page.tsx) – renders the `AdminShell` and demonstrates
  composing the default routes.
- [`app/api/auth/route.ts`](./app/api/auth/route.ts) – stand-in implementation of a forward-auth handler.

All runtime secrets are read from environment variables so you can point the example at any Catalyst
sandbox without code changes.
