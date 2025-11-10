---
title: Security posture
description: Overview of Catalyst Auth's security controls, threat model, and recommended hardening steps.
---

Catalyst Auth secures identity, policy, and webhook workloads. The following controls are recommended for
production deployments.

## Threat model

- **Credential theft.** Mitigate through short-lived session tokens, rotated secrets, and MFA integration with
  upstream IdPs.
- **Replay attacks.** Webhooks are signed using HMAC SHA-256 headers. Consumers must verify signatures and reject
  stale timestamps.
- **Data exfiltration.** Profiles and entitlements are stored in PostgreSQL. Enable encryption at rest and limit
  access to service accounts.
- **Denial of service.** Rate-limit forward-auth requests at the edge. Autoscale workers to absorb webhook bursts.

## Platform controls

1. **Telemetry sanitization.** Avoid logging sensitive payloads. The shared telemetry package logs structured JSON
   without raw secrets.
2. **Network segmentation.** Run services in private subnets. Permit ingress only from trusted load balancers.
3. **Policy enforcement.** Implement fine-grained RBAC using Catalyst entitlements. Audit policy changes via
   the audit log tables.
4. **Dependency management.** Pin package versions and run `pnpm audit` in CI. Semantic-release automates version
   bumps and changelog generation.
5. **Operational separation.** Use distinct credentials per environment. Restrict production access to on-call
   operators with hardware-backed MFA.

## Hardening checklist

- Enable Content Security Policy (CSP) and HTTP security headers on applications protected by forward-auth.
- Integrate webhook endpoints with zero-trust networks (mutual TLS, IP allowlists).
- Monitor `forward_auth_requests_total{status="401"}` spikes to detect credential stuffing.
- Configure database row-level security if multi-tenant data isolation is required.
- Conduct regular penetration testing and threat modeling sessions.

## Compliance considerations

Catalyst Auth can assist with compliance frameworks (SOC 2, ISO 27001) when combined with operational evidence:

- Collect trace IDs and logs for incident investigations.
- Retain audit logs for policy, entitlement, and session changes.
- Document backup/restore drills and webhook replay exercises.

> See the architecture overview for system diagrams and component responsibilities.
