# Elysia forward-auth demo

A Bun + Elysia server that proxies Catalyst forward-auth requests and serves a Vite-powered dashboard
consuming the UI packages. The example is intentionally lightweight so it can run entirely with Bun
(`bun install && bun run dev`).

## Structure

- [`server.ts`](./src/server.ts) – Elysia HTTP server exposing `/forward-auth` and `/api/*` endpoints.
- [`ui/App.tsx`](./ui/App.tsx) – Vite SPA that renders the `AdminShell` with SDK clients backed by the server routes.
- [`vite.config.ts`](./vite.config.ts) – development tooling for the SPA.

## Running locally

```bash
bun install
bun run dev
```

The dev server runs on <http://localhost:5173> with API requests proxied to the Bun server on port
8787. Update `.env` with your Catalyst credentials to hit a live environment.
