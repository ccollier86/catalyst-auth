-- Entitlements redesign to support multi-subject assignments
DROP TABLE IF EXISTS auth_entitlements;

CREATE TABLE IF NOT EXISTS auth_entitlements (
    id TEXT PRIMARY KEY,
    subject_kind TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    entitlement TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_entitlements_unique_subject
    ON auth_entitlements (subject_kind, subject_id, entitlement);

CREATE INDEX IF NOT EXISTS auth_entitlements_subject_idx
    ON auth_entitlements (subject_kind, subject_id);

-- Session indexes for activity queries
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
    ON auth_sessions (user_id);

CREATE INDEX IF NOT EXISTS auth_sessions_last_seen_idx
    ON auth_sessions (last_seen_at);

-- Webhook registry tables
CREATE TABLE IF NOT EXISTS auth_webhook_subscriptions (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    event_types TEXT[] NOT NULL,
    target_url TEXT NOT NULL,
    secret TEXT NOT NULL,
    headers JSONB DEFAULT '{}'::JSONB,
    retry_policy JSONB,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS auth_webhook_subscriptions_org_active_idx
    ON auth_webhook_subscriptions (org_id, active);

CREATE TABLE IF NOT EXISTS auth_webhook_deliveries (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ,
    payload JSONB NOT NULL,
    response JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_webhook_deliveries_subscription_idx
    ON auth_webhook_deliveries (subscription_id);

CREATE INDEX IF NOT EXISTS auth_webhook_deliveries_status_idx
    ON auth_webhook_deliveries (status);

CREATE INDEX IF NOT EXISTS auth_webhook_deliveries_next_attempt_idx
    ON auth_webhook_deliveries (next_attempt_at);
