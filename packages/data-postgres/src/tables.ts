export interface PostgresTableNames {
  readonly users: string;
  readonly orgs: string;
  readonly groups: string;
  readonly memberships: string;
  readonly entitlements: string;
  readonly sessions: string;
  readonly keys: string;
  readonly auditEvents: string;
  readonly webhookSubscriptions: string;
  readonly webhookDeliveries: string;
}

export const defaultPostgresTableNames: PostgresTableNames = {
  users: "auth_users",
  orgs: "auth_orgs",
  groups: "auth_groups",
  memberships: "auth_memberships",
  entitlements: "auth_entitlements",
  sessions: "auth_sessions",
  keys: "auth_keys",
  auditEvents: "auth_audit_events",
  webhookSubscriptions: "auth_webhook_subscriptions",
  webhookDeliveries: "auth_webhook_deliveries",
};

export const resolvePostgresTableNames = (
  overrides?: Partial<PostgresTableNames>,
): PostgresTableNames => ({ ...defaultPostgresTableNames, ...(overrides ?? {}) });
