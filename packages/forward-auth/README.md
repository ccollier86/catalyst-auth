# @catalyst-auth/forward-auth

Utilities for adapting Catalyst policy decisions to edge proxies such as Traefik. The package ships a `ForwardAuthService` that
validates access credentials, evaluates policy decisions, and emits decision JWTs that can be cached at the proxy or application
layer.

## Installation

```sh
pnpm add @catalyst-auth/forward-auth
```

## Forward auth service lifecycle

A `ForwardAuthService` instance requires an identity provider adapter and a policy engine adapter. The service resolves the
requesting identity, invokes the policy engine, and returns an allow/deny response with proxy-friendly headers. Responses include
an optional `x-decision-jwt` header that carries a compact policy decision token for downstream caching.

```ts
import { ForwardAuthService } from "@catalyst-auth/forward-auth";
import { createTokenService } from "@catalyst-auth/token-service";

const tokenService = createTokenService({
  issuer: "https://auth.example.com",
  decision: {
    signer: {
      algorithm: "EdDSA",
      privateKey: process.env.DECISION_PRIVATE_KEY!,
      keyId: "decision-ed25519",
    },
    audience: "traefik",
  },
});

const forwardAuth = new ForwardAuthService(
  { idp: authentikAdapter, policyEngine },
  {
    decisionCache: redisDecisionCache,
    decisionCacheTtlSeconds: 55,
    buildResource: (request) => ({ type: "http", id: request.path }),
  },
);
```

### Postgres-backed runtime

Production deployments can compose the forward-auth service with the Postgres data plane using
`createPostgresForwardAuthRuntime`. The helper provisions the Postgres repositories and injects the
audit log, key store, and session store into the service while letting you customise cache, logger,
and hashing behaviour.

When the session store is available, `ForwardAuthService` automatically upserts session activity.
It merges metadata from the identity provider with proxy headers under a `forwardAuth` key so you
can inspect IP, host, and user-agent history for each session.

```ts
import { Pool } from "pg";
import { createPostgresForwardAuthRuntime } from "@catalyst-auth/forward-auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const { service, dataSource } = createPostgresForwardAuthRuntime({
  idp: authentikAdapter,
  policyEngine,
  pool,
  forwardAuth: {
    decisionCache: redisDecisionCache,
    logger,
  },
});

// `service` handles forward auth requests and records audit + session activity in Postgres.
// `dataSource` exposes the repositories for seeding or additional wiring.
```

### Decision caching semantics

The service automatically caches successful policy decisions when a `decisionCache` is configured. Cache entries are keyed by the
minted decision JWT and expire after the configured TTL (default 55 seconds). Cached entries are tagged with `decision-jwt` to
support targeted invalidation.

When a request later includes `Authorization: Decision <token>` or the `x-decision-jwt` header, the service bypasses identity and
policy evaluation if the token is still cached. Downstream applications should validate the decision JWT against the JWKS exposed
by the token service (see below) and honour the `exp` claim.

## Traefik label generation

`buildTraefikForwardAuthConfig` produces a deterministic set of Docker labels that attach the forward-auth middleware and optional
decision-distribution routers.

```ts
import { buildTraefikForwardAuthConfig } from "@catalyst-auth/forward-auth";

const { labels, decisionRouters } = buildTraefikForwardAuthConfig({
  serviceName: "app-service",
  forwardAuthUrl: "http://forward-auth:3001/forward-auth",
  hosts: ["app.example.com", "app.staging.example.com"],
  authResponseHeaders: ["x-user-sub", "x-decision-jwt", "x-org-id"],
  decisionRoutes: [
    {
      pathPrefix: "/_catalyst/decision/jwks",
      upstreamUrl: "http://forward-auth:3001/decision/jwks",
    },
  ],
});
```

Attach the `labels` array to your protected service and apply the `decisionRouters` entries to the container that exposes JWKS and
other decision distribution endpoints.

## Decision JWT distribution helpers

The package contains two distribution utilities:

- `createDecisionCacheWarmer` issues HTTP calls to the forward-auth endpoint so Traefik caches decision JWTs during deployment
  rollouts.
- `createDecisionJwksResponse` exposes a JWKS document derived from the token service signing keys. Pair it with the
  middleware package (see below) to serve JWKS from Express, Elysia, or Next.js routes.

```ts
import { createDecisionCacheWarmer, createDecisionJwksResponse } from "@catalyst-auth/forward-auth";

const warmDecisions = createDecisionCacheWarmer({
  fetch,
  forwardAuthEndpoint: "http://forward-auth:3001/forward-auth",
  requests: [
    { path: "/team", method: "GET", headers: { authorization: "Bearer ..." } },
  ],
});
await warmDecisions();

export const handler = () => createDecisionJwksResponse({
  cacheControlSeconds: 300,
  keys: [
    {
      algorithm: "EdDSA",
      privateKey: process.env.DECISION_PRIVATE_KEY!,
      keyId: "decision-ed25519",
    },
  ],
});
```

## Deployment wiring with Postgres and token services

A typical production deployment wires the forward-auth service with the Catalyst token and identity services:

1. The token service stores signing keys in Postgres (via the key-memory adapter) and mints decision JWTs for forward auth.
2. The forward-auth service uses the token service's public JWKS (served via `createDecisionJwksResponse`) so downstream consumers
   can validate cached decisions.
3. Policy decisions leverage the Postgres-backed profile and webhook memory stores to enrich the identity context before
   evaluation.

The `@catalyst-auth/middleware` package wraps these behaviours for Express, Next.js, and Elysia applications so upstream services
can trust the proxy-provided headers without duplicating decision logic.
