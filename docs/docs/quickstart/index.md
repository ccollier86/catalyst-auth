---
title: Quickstart
description: Provision Catalyst Auth locally or in a sandbox to explore the SDK, forward auth gateway, and webhook processing.
---

Catalyst Auth ships as a collection of composable packages. This quickstart walks you through a minimal
end-to-end environment so you can experiment with identity flows, forward authentication, and webhook
processing.

## Prerequisites

- **Node.js 20+ and pnpm 8+.** The repo is a pnpm workspace. Install dependencies with `pnpm install` from the
  repository root.
- **PostgreSQL 15+.** The data-postgres adapter expects a PostgreSQL instance with UUID generation enabled
  (`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`).
- **Redis 7+ (optional).** Required when exercising the webhook queue adapters.
- **OpenTelemetry collector (optional).** Metrics and traces are emitted through the `@catalyst-auth/telemetry`
  package and can be exported to any collector endpoint.

## 1. Bootstrap dependencies

```bash
# Start PostgreSQL and Redis using Docker Compose
$ docker compose -f foundation_setup_PLAN.md up -d postgres redis

# Create the application database
$ createdb catalyst_auth_dev
```

Run the shared migrations:

```bash
$ pnpm --filter @catalyst-auth/data-postgres migrate --database-url "postgres://localhost/catalyst_auth_dev"
```

## 2. Seed reference data

The repository contains deterministic seed scripts to hydrate the database with demo identities, profiles,
keys, and webhook subscriptions.

```bash
$ pnpm --filter @catalyst-auth/data-postgres seed --database-url "postgres://localhost/catalyst_auth_dev"
```

## 3. Exercise the SDK

```ts
import { createCatalystSdk } from "@catalyst-auth/sdk";
import { createProfileMemoryStore } from "@catalyst-auth/profile-memory";
import { createKeyMemoryStore } from "@catalyst-auth/key-memory";
import { createWebhookMemoryStore } from "@catalyst-auth/webhook-memory";

const sdk = createCatalystSdk({
  idp: /* your IdP adapter */,
  profileStore: createProfileMemoryStore(),
  keyStore: createKeyMemoryStore(),
  entitlementStore: /* entitlement store */,
  sessionStore: /* session store */,
  webhookDelivery: /* HTTP client */, 
  webhookSubscriptionStore: createWebhookMemoryStore(),
  webhookDeliveryStore: createWebhookMemoryStore(),
  tokenService: /* JWT service */,
});

const result = await sdk.auth.signInWithCode({
  code: "demo-code",
  redirectUri: "https://example.com/callback",
  clientId: "demo-client",
});
```

All SDK operations automatically emit OpenTelemetry traces and metrics. Attach a collector to
`OTEL_EXPORTER_OTLP_ENDPOINT` to ingest them.

## 4. Launch the forward-auth gateway

```bash
$ pnpm --filter @catalyst-auth/forward-auth dev --database-url "postgres://localhost/catalyst_auth_dev"
```

The gateway exposes health checks at `/healthz` and forward-auth routes under `/forward-auth`. Metrics and
traces are shipped through the shared telemetry package; configure `OTEL_SERVICE_NAME=forward-auth` to
customize service naming.

## 5. Process webhooks

```bash
$ pnpm --filter @catalyst-auth/webhook-worker dev --database-url "postgres://localhost/catalyst_auth_dev"
```

Workers stream telemetry that tracks run-loop success, retry scheduling, and dead-letter events. Use the
operations runbooks to wire alerts on `webhook_worker_*` metrics.

> **Next steps:** review the setup guides for production deployments and the runbooks for day-2 operations.
