---
title: Platform topology
description: Build a production-ready deployment of Catalyst Auth spanning identity services, policy enforcement, and webhook delivery.
---

Catalyst Auth is intentionally modular. The platform can be deployed incrementally or end-to-end depending on
your requirements. This guide documents a reference production topology.

## Core services

| Component | Responsibility | Notes |
| --- | --- | --- |
| `@catalyst-auth/data-postgres` | Authoritative system of record for profiles, entitlements, sessions, audit logs, and webhook metadata. | Run against PostgreSQL 15+ with HA (Patroni, Aurora, Crunchy). Enable PITR. |
| `@catalyst-auth/forward-auth` | Edge gateway that validates sessions and enforces policy decisions. | Deploy close to applications (e.g., Kubernetes ingress, Fly.io). Use HTTPS termination and mTLS to upstreams. |
| `@catalyst-auth/webhook-worker` | Processes webhook deliveries, retries failures, and manages dead letters. | Horizontally scalable workers backed by Redis or alternative queue adapters. |
| Identity provider adapter | Integrates Catalyst Auth with your upstream IdP (Okta, Authentik, Azure AD). | Implement `IdpAdapterPort` and provide telemetry/logging per adapter. |

## Network layout

1. **Public edge.** Forward-auth runs behind a load balancer with TLS termination. Configure Web Application
   Firewall (WAF) rules and DDoS mitigation at this layer.
2. **Application mesh.** Services integrate with Catalyst SDK over internal networks. Configure mutual TLS and
   short-lived credentials. The SDK now exports traces/metrics with the service name `catalyst-sdk` by default.
3. **Data plane.** PostgreSQL resides on a private network segment with restricted inbound rules. Redis queues
   (if used) should be co-located with webhook workers to reduce latency.

## Observability

- Deploy an OpenTelemetry collector. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at the collector for every service.
- Scrape Prometheus metrics emitted by counters/histograms introduced in this change set:
  - `forward_auth_requests_total`
  - `forward_auth_request_duration_ms`
  - `postgres_queries_total`
  - `postgres_query_duration_ms`
  - `postgres_transactions_total`
  - `postgres_transaction_duration_ms`
  - `webhook_worker_runs_total`
  - `webhook_worker_run_duration_ms`
  - `webhook_worker_deliveries_total`
- Correlate trace spans (`forward_auth.request`, `postgres.query`, `sdk.*`, `webhook_worker.run_once`) with
  application-level telemetry to accelerate incident response.

## Secrets and configuration

Store credentials in your secret manager of choice. The following configuration keys are commonly required:

- `DATABASE_URL` / `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- `REDIS_URL`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `FORWARD_AUTH_JWT_SECRET`
- `WEBHOOK_SIGNING_SECRET`
- IdP-specific credentials (client IDs, client secrets, issuer URLs)

Use environment-variable templating (e.g., Doppler, Vault Agent) to present secrets to services securely.

## Deployment pipeline

1. Run `pnpm build` to compile all packages. The telemetry package ensures consistent instrumentation.
2. Execute unit tests with `pnpm test`. Integrate coverage reporting into your CI environment.
3. Build container images (see `.github/workflows/release.yml`) and scan them for vulnerabilities.
4. Promote artifacts through staged environments (dev → staging → production). Each stage should run the
   runbooks outlined in the Operations section before advancing.

> Continue with the forward-auth and webhook-specific setup guides for component-level details.
