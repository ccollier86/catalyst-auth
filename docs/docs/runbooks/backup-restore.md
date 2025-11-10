---
title: Backup & restore
description: Procedures for database backups, Redis snapshots, and webhook replay.
---

This runbook ensures Catalyst Auth data stores can be restored with minimal data loss.

## PostgreSQL

1. **Nightly logical backups.** Use `pg_dump` or managed service snapshots. Store archives in immutable object
   storage with retention matching compliance requirements.
2. **Point-in-time recovery (PITR).** Enable WAL archiving and test recovery into staging monthly. Validate that
   the restored environment can:
   - List users and entitlements via the SDK.
   - Run forward-auth health checks.
   - Enumerate pending webhook deliveries.
3. **Restoration checklist.**
   - Provision a new database instance.
   - Apply base backup and replay WAL until the desired timestamp.
   - Update application credentials (`DATABASE_URL`) and rotate secrets.
   - Run smoke tests against the restored environment before cutting over traffic.

## Redis (or queue adapter)

- Enable AOF/RDB snapshots for Redis. Store snapshots alongside database backups.
- For managed queues, rely on built-in durability (SQS message retention, Pub/Sub persistence).
- During restore, flush the queue to avoid replaying stale deliveries unless required.

## Webhook replay

1. Identify affected deliveries using the webhook worker metrics and database queries:

   ```sql
   SELECT id, subscription_id, status, error_message
   FROM webhook_deliveries
   WHERE status = 'dead_lettered' AND updated_at >= NOW() - INTERVAL '24 hours';
   ```

2. For each delivery:
   - Confirm the downstream endpoint is healthy.
   - Update the record to `pending` and set `next_attempt_at` to `NOW()`.
   - Allow the worker to pick up the delivery. Verify success via logs and metrics.

3. Document replay steps in the incident ticket and capture any manual adjustments.

## Validation cadence

- Run full restore drills quarterly covering PostgreSQL, queue state, and webhook replay.
- Capture metrics before and after the drill to ensure baseline parity.
- Update this runbook with new insights or automation scripts.
