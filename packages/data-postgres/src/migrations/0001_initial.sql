-- Profiles
CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    authentik_id TEXT NOT NULL,
    email TEXT NOT NULL,
    primary_org_id TEXT,
    display_name TEXT,
    avatar_url TEXT,
    labels JSONB DEFAULT '{}'::JSONB,
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS auth_orgs (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    profile JSONB NOT NULL,
    labels JSONB DEFAULT '{}'::JSONB,
    settings JSONB DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS auth_groups (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    parent_group_id TEXT,
    labels JSONB DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS auth_memberships (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    role TEXT NOT NULL,
    group_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
    labels_delta JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_entitlements (
    id TEXT PRIMARY KEY,
    membership_id TEXT NOT NULL,
    entitlement TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions
CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    factors_verified JSONB DEFAULT '[]'::JSONB,
    metadata JSONB
);

-- Keys
CREATE TABLE IF NOT EXISTS auth_keys (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT,
    description TEXT,
    created_by_kind TEXT,
    created_by_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    usage_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    scopes TEXT[] NOT NULL,
    labels JSONB DEFAULT '{}'::JSONB,
    metadata JSONB,
    revoked_at TIMESTAMPTZ,
    revoked_by_kind TEXT,
    revoked_by_id TEXT,
    revocation_reason TEXT
);

-- Audit Events
CREATE TABLE IF NOT EXISTS auth_audit_events (
    id TEXT PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    actor JSONB,
    subject JSONB,
    resource JSONB,
    metadata JSONB,
    correlation_id TEXT
);
