---
title: Operations runbook
description: Day-2 operations checklists covering monitoring, incident response, and routine maintenance.
---

This runbook documents the operational cadence for Catalyst Auth.

## Daily checks

1. **Telemetry dashboards.**
   - Review error rates across `forward_auth_requests_total`, `webhook_worker_deliveries_total`, and SDK metrics.
   - Confirm OpenTelemetry collector health and span ingestion volumes.
2. **Database health.**
   - Verify replication lag and backup success.
   - Inspect slow query logs surfaced by `postgres_query_duration_ms` histograms.
3. **Queue depth.**
   - Alert when pending deliveries exceed thresholds. Use `webhook_worker_runs_total` growth rate as an early signal.

## Incident response

| Scenario | Indicators | Response |
| --- | --- | --- |
| Forward-auth outage | 5xx surge, health endpoint failures | Drain traffic, redeploy, validate upstream IdP connectivity. Review span traces to isolate bottlenecks. |
| Postgres performance regression | Latency spikes in `postgres_query_duration_ms` | Capture EXPLAIN plans for offending queries. Consider adding indexes or tuning work_mem. |
| Webhook backlog | Rising `pending` deliveries, repeated retries | Inspect subscription targets, throttle failing endpoints, replay via CLI after resolution. |

When responding:

1. Capture trace IDs from OpenTelemetry spans and attach to incident tickets.
2. Export structured logs for the timeframe using your log pipeline.
3. Once mitigated, backfill runbook notes and create follow-up tasks.

## Routine maintenance

- Rotate secrets quarterly. Update Kubernetes secrets or parameter store entries.
- Apply PostgreSQL security patches. Run integration tests against staging before production promotion.
- Validate backup restore procedures monthly using the backup/restore runbook.
- Review SDK instrumentation coverage; ensure new modules wrap operations using `instrumentSdkModule`.

## Change management checklist

1. Create a change request describing scope, risk, and rollback.
2. Run `pnpm lint`, `pnpm test`, and `pnpm build` locally.
3. Validate staging deployment with synthetic transactions (sign-in, forward-auth request, webhook dispatch).
4. Execute change during approved window. Monitor metrics for 30 minutes post-deploy.
5. Document outcomes and update runbooks with lessons learned.
