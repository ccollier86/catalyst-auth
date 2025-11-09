import { createHash } from "node:crypto";
import type {
  AuditLogPort,
  CachePort,
  EffectiveIdentity,
  IdpAdapterPort,
  KeyRecord,
  KeyStorePort,
  PolicyDecision,
  PolicyEnginePort,
  SessionRecord,
  SessionDescriptor,
  SessionStorePort,
  SessionTouchUpdate,
} from "@catalyst-auth/contracts";

import type {
  DecisionCacheEntry,
  ForwardAuthConfig,
  ForwardAuthLogger,
  ForwardAuthRequest,
  ForwardAuthResponse,
} from "./types.js";
import { normalizeHeaders, toHeaderMap } from "./utils.js";

const DEFAULT_DECISION_TTL_SECONDS = 55;
const DEFAULT_CACHE_PREFIX = "forward-auth:decision";

type IdentityResolution =
  | { readonly ok: true; readonly identity: EffectiveIdentity }
  | { readonly ok: false; readonly response: ForwardAuthResponse };

type CredentialDescriptor =
  | { readonly kind: "access-token"; readonly token: string }
  | { readonly kind: "api-key"; readonly secret: string };

export class ForwardAuthService {
  private readonly idp: IdpAdapterPort;
  private readonly policyEngine: PolicyEnginePort;
  private readonly keyStore?: KeyStorePort;
  private readonly cache?: CachePort<DecisionCacheEntry>;
  private readonly auditLog?: AuditLogPort;
  private readonly sessionStore?: SessionStorePort;
  private readonly logger?: ForwardAuthLogger;
  private readonly decisionTtlSeconds: number;
  private readonly cacheKeyPrefix: string;
  private readonly buildAction?: ForwardAuthConfig["buildAction"];
  private readonly buildResource?: ForwardAuthConfig["buildResource"];
  private readonly buildEnvironment?: ForwardAuthConfig["buildEnvironment"];
  private readonly hashApiKey?: ForwardAuthConfig["hashApiKey"];
  private readonly now: () => Date;

  constructor(dependencies: {
    readonly idp: IdpAdapterPort;
    readonly policyEngine: PolicyEnginePort;
  }, config: ForwardAuthConfig = {}) {
    this.idp = dependencies.idp;
    this.policyEngine = dependencies.policyEngine;
    this.keyStore = config.keyStore;
    this.cache = config.decisionCache;
    this.auditLog = config.auditLog;
    this.sessionStore = config.sessionStore;
    this.logger = config.logger;
    this.hashApiKey = config.hashApiKey ?? defaultHashApiKey;
    this.decisionTtlSeconds = Math.max(
      1,
      config.decisionCacheTtlSeconds ?? DEFAULT_DECISION_TTL_SECONDS,
    );
    this.cacheKeyPrefix = config.decisionCacheKeyPrefix ?? DEFAULT_CACHE_PREFIX;
    this.buildAction = config.buildAction;
    this.buildResource = config.buildResource;
    this.buildEnvironment = config.buildEnvironment;
    this.now = config.now ?? (() => new Date());
  }

  async handle(request: ForwardAuthRequest): Promise<ForwardAuthResponse> {
    const headers = normalizeHeaders(request.headers);
    const cached = await this.tryResolveCachedDecision(headers["x-decision-jwt"]);
    if (cached) {
      return cached;
    }

    const credentials = this.extractCredentials(headers);
    if (!credentials) {
      return this.unauthorized("missing_credentials");
    }

    const orgId = request.orgId ?? headers["x-catalyst-org"];
    const identityResult =
      credentials.kind === "access-token"
        ? await this.resolveAccessTokenIdentity(credentials.token, orgId)
        : await this.resolveApiKeyIdentity(credentials.secret, orgId);

    if (!identityResult.ok) {
      return identityResult.response;
    }

    const identity = identityResult.identity;
    await this.ensureSessionRecord(identity, headers);
    const action =
      request.action ?? this.buildAction?.(request) ?? `${request.method.toUpperCase()} ${request.path}`;
    const resource = request.resource ?? this.buildResource?.(request);

    const environmentFromBuilder = this.buildEnvironment?.(request, identity);
    const environment = mergeEnvironment(environmentFromBuilder, request.environment);

    const policyResult = await this.policyEngine.evaluate({
      identity,
      action,
      resource,
      environment,
    });

    if (!policyResult.ok) {
      this.logger?.error?.("Policy evaluation failed", policyResult.error);
      return this.failure("policy_error", 502, policyResult.error.message);
    }

    const decision = policyResult.value;
    if (!decision.allow) {
      return this.forbidden(decision.reason ?? "policy_denied", decision.obligations);
    }

    const response = this.buildAllowResponse(identity, decision);
    await this.maybeCacheDecision(identity, decision, response.headers);
    return response;
  }

  private async resolveAccessTokenIdentity(token: string, orgId?: string): Promise<IdentityResolution> {
    const validationResult = await this.idp.validateAccessToken(token);
    if (!validationResult.ok) {
      this.logger?.error?.("Access token validation failed", validationResult.error);
      return { ok: false, response: this.failure("token_validation_error", 502, validationResult.error.message) };
    }

    const validation = validationResult.value;
    if (!validation.active || !validation.subject) {
      return { ok: false, response: this.unauthorized("inactive_token") };
    }

    const identityResult = await this.idp.buildEffectiveIdentity(validation.subject, orgId);
    if (!identityResult.ok) {
      this.logger?.error?.("Failed to build effective identity", identityResult.error);
      return { ok: false, response: this.failure("identity_resolution_error", 502, identityResult.error.message) };
    }

    return { ok: true, identity: identityResult.value };
  }

  private async resolveApiKeyIdentity(secret: string, orgId?: string): Promise<IdentityResolution> {
    if (!this.keyStore || !this.hashApiKey) {
      this.logger?.error?.("API key presented but key store or hash function missing");
      return {
        ok: false,
        response: this.failure("api_key_not_supported", 500, "API key handling is not configured"),
      };
    }

    const hash = await this.hashApiKey(secret);
    const keyResult = await this.keyStore.getKeyByHash(hash);
    if (!keyResult.ok) {
      this.logger?.error?.("Key lookup failed", keyResult.error);
      return { ok: false, response: this.failure("api_key_lookup_failed", 502, keyResult.error.message) };
    }

    const key = keyResult.value;
    if (!key) {
      return { ok: false, response: this.unauthorized("invalid_api_key") };
    }

    if (!isKeyActive(key, this.now())) {
      return { ok: false, response: this.forbidden("api_key_inactive") };
    }

    if (key.owner.kind === "user") {
      const identityResult = await this.idp.buildEffectiveIdentity(key.owner.id, orgId);
      if (!identityResult.ok) {
        this.logger?.error?.("Failed to build identity for key owner", identityResult.error);
        return {
          ok: false,
          response: this.failure("identity_resolution_error", 502, identityResult.error.message),
        };
      }
      const merged = mergeIdentityWithKey(identityResult.value, key);
      await this.recordKeyUsage(key);
      return { ok: true, identity: merged };
    }

    const synthesizedIdentity = buildSyntheticIdentityForKey(key, orgId);
    await this.recordKeyUsage(key);
    return { ok: true, identity: synthesizedIdentity };
  }

  private async recordKeyUsage(key: KeyRecord): Promise<void> {
    if (!this.keyStore) {
      return;
    }
    const usageResult = await this.keyStore.recordKeyUsage(key.id, { usedAt: this.now().toISOString() });
    if (!usageResult.ok) {
      this.logger?.warn?.("Failed to record key usage", usageResult.error);
    }
  }

  private async ensureSessionRecord(
    identity: EffectiveIdentity,
    headers: Record<string, string>,
  ): Promise<void> {
    if (!this.sessionStore || !identity.sessionId || !identity.userId) {
      return;
    }

    const nowIso = this.now().toISOString();
    const metadataFromHeaders = buildSessionMetadata(headers);

    try {
      const existing = await this.sessionStore.getSession(identity.sessionId);
      if (existing) {
        const mergedMetadata = mergeMetadataRecords(existing.metadata, metadataFromHeaders);
        const update: SessionTouchUpdate = mergedMetadata
          ? { lastSeenAt: nowIso, metadata: mergedMetadata }
          : { lastSeenAt: nowIso };
        await this.sessionStore.touchSession(identity.sessionId, update);
        return;
      }
    } catch (error) {
      this.logger?.warn?.("Failed to read session before touch", error);
    }

    let descriptor: SessionDescriptor | undefined;
    try {
      const descriptorResult = await this.idp.listActiveSessions(identity.userId);
      if (descriptorResult.ok) {
        descriptor = descriptorResult.value.find((session) => session.id === identity.sessionId);
      } else {
        this.logger?.warn?.("Failed to fetch active sessions from identity provider", descriptorResult.error);
      }
    } catch (error) {
      this.logger?.warn?.("Failed to fetch active sessions from identity provider", error);
    }

    const mergedMetadata = mergeMetadataRecords(descriptor?.metadata, metadataFromHeaders);
    const record: SessionRecord = {
      id: identity.sessionId,
      userId: identity.userId,
      createdAt: descriptor?.createdAt ?? nowIso,
      lastSeenAt: nowIso,
      factorsVerified: descriptor?.factorsVerified ? [...descriptor.factorsVerified] : [],
      ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
    };

    try {
      await this.sessionStore.createSession(record);
      return;
    } catch (error) {
      this.logger?.warn?.("Failed to create session record", error);
    }

    const fallbackUpdate: SessionTouchUpdate = record.metadata
      ? { lastSeenAt: nowIso, metadata: record.metadata }
      : { lastSeenAt: nowIso };
    try {
      await this.sessionStore.touchSession(identity.sessionId, fallbackUpdate);
    } catch (error) {
      this.logger?.warn?.("Failed to update session after create failure", error);
    }
  }

  private async tryResolveCachedDecision(token?: string): Promise<ForwardAuthResponse | undefined> {
    if (!token || !this.cache) {
      return undefined;
    }
    const cacheKey = this.cacheKey(token);
    const cached = await this.cache.get(cacheKey);
    if (!cached) {
      return undefined;
    }
    const headers = { ...cached.headers, "x-decision-jwt": token };
    return { status: 200, headers };
  }

  private async maybeCacheDecision(
    identity: EffectiveIdentity,
    decision: PolicyDecision,
    headers: Record<string, string>,
  ): Promise<void> {
    if (!decision.decisionJwt || !this.cache) {
      return;
    }
    const cacheEntry: DecisionCacheEntry = {
      headers: { ...headers },
      expiresAt: new Date(this.now().getTime() + this.decisionTtlSeconds * 1000).toISOString(),
    };
    await this.cache.set(this.cacheKey(decision.decisionJwt), cacheEntry, {
      ttlSeconds: this.decisionTtlSeconds,
      tags: ["decision-jwt"],
    });

    await this.appendAuditEvent(decision.decisionJwt, identity, cacheEntry.expiresAt);
  }

  private async appendAuditEvent(
    decisionJwt: string,
    identity: EffectiveIdentity,
    expiresAt: string,
  ): Promise<void> {
    if (!this.auditLog) {
      return;
    }
    const result = await this.auditLog.appendEvent({
      category: "forward_auth",
      action: "decision_cached",
      occurredAt: this.now().toISOString(),
      subject: identity.userId
        ? { type: "user", id: identity.userId, labels: { orgId: identity.orgId } }
        : undefined,
      resource: { type: "decision", id: decisionJwt },
      metadata: {
        expiresAt,
        groups: identity.groups,
        roles: identity.roles,
        scopes: identity.scopes,
        entitlements: identity.entitlements,
      },
    });
    if (!result.ok) {
      this.logger?.warn?.("Failed to append forward auth audit event", result.error);
    }
  }

  private extractCredentials(headers: Record<string, string>): CredentialDescriptor | undefined {
    const authorization = headers["authorization"];
    const apiKeyHeader = headers["x-api-key"];

    if (apiKeyHeader && apiKeyHeader.trim().length > 0) {
      return { kind: "api-key", secret: apiKeyHeader.trim() };
    }

    if (!authorization) {
      return undefined;
    }

    const [scheme, ...rest] = authorization.trim().split(/\s+/);
    if (!scheme || rest.length === 0) {
      return undefined;
    }

    const value = rest.join(" ");
    if (scheme.toLowerCase() === "bearer") {
      return { kind: "access-token", token: value };
    }

    if (scheme.toLowerCase() === "decision") {
      // Decision JWTs are handled via cache, but if a client sends one as Authorization we still honour cache lookup.
      return undefined;
    }

    if (scheme.toLowerCase() === "key") {
      return { kind: "api-key", secret: value };
    }

    return undefined;
  }

  private buildAllowResponse(identity: EffectiveIdentity, decision: PolicyDecision): ForwardAuthResponse {
    const headers: Record<string, string> = toHeaderMap({
      "x-user-sub": identity.userId,
      "x-org-id": identity.orgId,
      "x-session-id": identity.sessionId,
      "x-user-groups": identity.groups.join(","),
      "x-user-roles": identity.roles.join(","),
      "x-user-entitlements": identity.entitlements.join(","),
      "x-user-scopes": dedupe(identity.scopes).join(","),
      "x-user-labels": serializeLabels(identity.labels),
    });

    if (decision.decisionJwt) {
      headers["x-decision-jwt"] = decision.decisionJwt;
    }

    if (decision.reason) {
      headers["x-forward-auth-reason"] = decision.reason;
    }

    if (decision.obligations) {
      headers["x-policy-obligations"] = JSON.stringify(decision.obligations);
    }

    return { status: 200, headers };
  }

  private unauthorized(reason: string): ForwardAuthResponse {
    return { status: 401, headers: { "x-forward-auth-error": reason } };
  }

  private forbidden(reason: string, obligations?: Record<string, unknown>): ForwardAuthResponse {
    const headers: Record<string, string> = { "x-forward-auth-error": reason };
    if (obligations) {
      headers["x-policy-obligations"] = JSON.stringify(obligations);
    }
    return { status: 403, headers };
  }

  private failure(code: string, status: number, message?: string): ForwardAuthResponse {
    const headers: Record<string, string> = { "x-forward-auth-error": code };
    if (message) {
      headers["x-forward-auth-error-message"] = message;
    }
    return { status, headers };
  }

  private cacheKey(token: string): string {
    return `${this.cacheKeyPrefix}:${token}`;
  }
}

const mergeEnvironment = (
  base?: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (!base && !overrides) {
    return undefined;
  }
  return { ...(base ?? {}), ...(overrides ?? {}) };
};

const buildSessionMetadata = (
  headers: Record<string, string>,
): Record<string, unknown> | undefined => {
  const context: Record<string, unknown> = {};
  const forwardedFor = headers["x-forwarded-for"];
  if (forwardedFor) {
    context.forwardedFor = forwardedFor;
    const primary = forwardedFor
      .split(",")
      .map((value) => value.trim())
      .find((value) => value.length > 0);
    if (primary) {
      context.ip = primary;
    }
  } else if (headers["x-real-ip"]) {
    context.ip = headers["x-real-ip"];
  }

  const userAgent = headers["user-agent"];
  if (userAgent) {
    context.userAgent = userAgent;
  }

  const host = headers["x-forwarded-host"];
  if (host) {
    context.host = host;
  }

  const protocol = headers["x-forwarded-proto"];
  if (protocol) {
    context.protocol = protocol;
  }

  const port = headers["x-forwarded-port"];
  if (port) {
    context.port = port;
  }

  if (Object.keys(context).length === 0) {
    return undefined;
  }

  return { forwardAuth: context };
};

const mergeMetadataRecords = (
  ...sources: ReadonlyArray<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined => {
  let merged: Record<string, unknown> | undefined;
  for (const source of sources) {
    if (!source) {
      continue;
    }
    merged = merged ? mergePlainRecords(merged, source) : mergePlainRecords({}, source);
  }
  return merged && Object.keys(merged).length > 0 ? merged : undefined;
};

const mergePlainRecords = (
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergePlainRecords(existing, value);
    } else if (isPlainObject(value)) {
      result[key] = mergePlainRecords({}, value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((entry) => (isPlainObject(entry) ? mergePlainRecords({}, entry) : entry));
    } else {
      result[key] = value;
    }
  }
  return result;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeIdentityWithKey = (identity: EffectiveIdentity, key: KeyRecord): EffectiveIdentity => ({
  ...identity,
  labels: { ...identity.labels, ...key.labels },
  scopes: dedupe([...identity.scopes, ...key.scopes]),
});

const buildSyntheticIdentityForKey = (key: KeyRecord, orgId?: string): EffectiveIdentity => ({
  userId: `key:${key.id}`,
  orgId: key.owner.kind === "org" ? key.owner.id : orgId,
  groups: [],
  labels: { ...key.labels },
  roles: [],
  entitlements: [],
  scopes: dedupe(key.scopes),
});

const dedupe = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const unique = new Set<string>();
  for (const value of values) {
    if (value) {
      unique.add(value);
    }
  }
  return Array.from(unique);
};

const serializeLabels = (labels: Record<string, unknown>): string => JSON.stringify(labels ?? {});

const isKeyActive = (key: KeyRecord, now: Date): boolean => {
  if (key.status !== "active") {
    return false;
  }
  if (!key.expiresAt) {
    return true;
  }
  return new Date(key.expiresAt).getTime() > now.getTime();
};

export const defaultHashApiKey = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");
