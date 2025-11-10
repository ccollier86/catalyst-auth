---
title: Forward-auth deployment
description: Configure the Catalyst forward-auth gateway with caching, health checks, and observability.
---

The forward-auth gateway protects upstream applications by verifying Catalyst sessions and policy decisions.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the Catalyst data store. |
| `FORWARD_AUTH_HEALTH_PATH` | Optional. Override the health check route (default `/healthz`). |
| `FORWARD_AUTH_CACHE_HEALTHCHECKS` | JSON array describing cache health checks invoked by the server. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Collector endpoint for OpenTelemetry traces and metrics. |

Forward-auth now exposes automatic metrics via `@catalyst-auth/telemetry`:

- `forward_auth_requests_total` (`route`, `status` labels)
- `forward_auth_request_duration_ms`
- `forward_auth_health_checks_total`

Spans named `forward_auth.request` include HTTP method, route, and status attributes. Errors bubble through
both spans and structured logs.

## Deployment steps

1. **Build artifact**

   ```bash
   $ pnpm --filter @catalyst-auth/forward-auth build
   ```

2. **Container image**

   Create a minimal container that runs `node dist/index.js`. The release workflow template in
   `.github/workflows/release.yml` demonstrates how to tag and publish images on release.

3. **Environment**

   - Deploy at the edge (Kubernetes Ingress, Traefik, NGINX, etc.).
   - Ensure upstream applications send authenticated requests through the gateway using the same session tokens.
   - Cache decisions locally when latency is critical. Inject cache health checks via the `cacheHealthChecks`
     option if you embed the server programmatically.

4. **Monitoring**

   - Alert on elevated `forward_auth_requests_total{status="401"}` and latency p95 derived from
     `forward_auth_request_duration_ms`.
   - Scrape `/healthz` (or configured path) and wire to uptime monitoring.
   - Forward structured logs to your SIEM. Logs include route and status context.

5. **Scaling**

   Forward-auth is stateless. Autoscale based on request volume or upstream latency. Use Kubernetes HPA or
   serverless autoscaling policies.

> For local validation, run `pnpm --filter @catalyst-auth/forward-auth dev` and exercise the quickstart flows.
