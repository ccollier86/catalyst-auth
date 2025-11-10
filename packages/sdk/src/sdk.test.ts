import { describe, expect, it } from "vitest";

import {
  err,
  ok,
  type CatalystError,
  type EffectiveIdentity,
  type EntitlementRecord,
  type EntitlementStorePort,
  type EntitlementQuery,
  type IdpAdapterPort,
  type IdpUserProfile,
  type JwtDescriptor,
  type MintDecisionJwtInput,
  type Result,
  type SessionRecord,
  type SessionStorePort,
  type SessionTouchUpdate,
  type SessionDescriptor,
  type TokenExchangeRequest,
  type TokenPair,
  type TokenRefreshRequest,
  type TokenServicePort,
  type TokenValidationResult,
  type WebhookSubscriptionRecord,
  type WebhookSubscriptionStorePort,
  type CreateWebhookSubscriptionInput,
  type UpdateWebhookSubscriptionInput,
  type WebhookDeliveryStorePort,
  type WebhookDeliveryRecord,
  type CreateWebhookDeliveryInput,
  type UpdateWebhookDeliveryInput,
  type WebhookDeliveryStatus,
  type ListWebhookDeliveriesOptions,
  type ListPendingDeliveriesOptions,
} from "@catalyst-auth/contracts";
import { createCatalystSdk } from "./index.js";
import { createInMemoryProfileStore } from "@catalyst-auth/profile-memory";
import { createMemoryKeyStore } from "@catalyst-auth/key-memory";
import { createMemoryWebhookDelivery } from "@catalyst-auth/webhook-memory";

class FakeIdpAdapter implements IdpAdapterPort {
  private readonly sessions = new Map<string, ReadonlyArray<SessionDescriptor>>();

  constructor() {
    const baseSession: SessionDescriptor = {
      id: "sess-1",
      userId: "user-1",
      createdAt: new Date(2024, 0, 1).toISOString(),
      lastSeenAt: new Date(2024, 0, 2).toISOString(),
      factorsVerified: ["password"],
      metadata: { device: "test" },
    };
    this.sessions.set("user-1", [baseSession]);
  }

  async exchangeCodeForTokens(request: TokenExchangeRequest): Promise<Result<TokenPair, CatalystError>> {
    if (request.code !== "good-code") {
      return err({
        code: "idp.exchange_failed",
        message: "Invalid authorization code.",
      });
    }
    return ok({
      accessToken: "access-good",
      refreshToken: "refresh-good",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
  }

  async refreshTokens(request: TokenRefreshRequest): Promise<Result<TokenPair, CatalystError>> {
    if (request.refreshToken !== "refresh-good") {
      return err({
        code: "idp.refresh_failed",
        message: "Refresh token rejected.",
      });
    }
    return ok({
      accessToken: "access-refreshed",
      refreshToken: "refresh-rotated",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
  }

  async validateAccessToken(token: string): Promise<Result<TokenValidationResult, CatalystError>> {
    return ok({
      active: token !== "invalid-token",
      subject: token === "invalid-token" ? undefined : "user-1",
    });
  }

  async fetchUserProfile(userId: string): Promise<Result<IdpUserProfile, CatalystError>> {
    return ok({
      id: userId,
      email: "user@example.com",
      authentikMeta: {},
      displayName: "Test User",
    });
  }

  async listActiveSessions(userId: string): Promise<Result<ReadonlyArray<SessionDescriptor>, CatalystError>> {
    return ok(this.sessions.get(userId) ?? []);
  }

  async buildEffectiveIdentity(userId: string, orgId?: string): Promise<Result<EffectiveIdentity, CatalystError>> {
    return ok({
      userId,
      orgId,
      sessionId: "sess-1",
      groups: ["group-1"],
      labels: { plan: "pro" },
      roles: ["admin"],
      entitlements: ["manage:all"],
      scopes: ["openid"],
    });
  }
}

class FakeTokenService implements TokenServicePort {
  async mintDecisionJwt(_input: MintDecisionJwtInput): Promise<Result<JwtDescriptor, CatalystError>> {
    return ok({
      token: "jwt-token",
      expiresAt: new Date(Date.now() + 30000).toISOString(),
    });
  }
}

class FakeEntitlementStore implements EntitlementStorePort {
  private readonly records = new Map<string, EntitlementRecord>();

  constructor() {
    const record: EntitlementRecord = {
      id: "ent-1",
      subjectKind: "user",
      subjectId: "user-1",
      entitlement: "feature:basic",
      createdAt: new Date(2024, 0, 1).toISOString(),
      metadata: { plan: "starter" },
    };
    this.records.set(record.id, record);
  }

  async listEntitlements(subject: EntitlementQuery) {
    return Array.from(this.records.values()).filter(
      (record) => record.subjectKind === subject.subjectKind && record.subjectId === subject.subjectId,
    );
  }

  async listEntitlementsForSubjects(subjects: ReadonlyArray<EntitlementQuery>) {
    return Array.from(this.records.values()).filter((record) =>
      subjects.some(
        (subject) => record.subjectKind === subject.subjectKind && record.subjectId === subject.subjectId,
      ),
    );
  }

  async upsertEntitlement(entitlement: EntitlementRecord) {
    this.records.set(entitlement.id, entitlement);
    return entitlement;
  }

  async removeEntitlement(id: string) {
    this.records.delete(id);
  }
}

class FakeSessionStore implements SessionStorePort {
  private readonly records = new Map<string, SessionRecord>();

  constructor() {
    const record: SessionRecord = {
      id: "sess-1",
      userId: "user-1",
      createdAt: new Date(2024, 0, 1).toISOString(),
      lastSeenAt: new Date(2024, 0, 2).toISOString(),
      factorsVerified: ["password"],
      metadata: { device: "seed" },
    };
    this.records.set(record.id, record);
  }

  async getSession(id: string) {
    return this.records.get(id);
  }

  async listSessionsByUser(userId: string) {
    return Array.from(this.records.values()).filter((record) => record.userId === userId);
  }

  async createSession(session: SessionRecord) {
    this.records.set(session.id, session);
    return session;
  }

  async touchSession(id: string, update: SessionTouchUpdate) {
    const current = this.records.get(id);
    if (!current) {
      throw new Error(`Session ${id} not found`);
    }
    const next: SessionRecord = {
      ...current,
      lastSeenAt: update.lastSeenAt,
      factorsVerified: update.factorsVerified ?? current.factorsVerified,
      metadata: update.metadata ?? current.metadata,
    };
    this.records.set(id, next);
    return next;
  }

  async deleteSession(id: string) {
    this.records.delete(id);
  }
}

const cloneHeaders = (headers: Record<string, string>): Record<string, string> => ({ ...headers });

const cloneMetadata = (metadata: Record<string, unknown> | undefined) =>
  metadata ? { ...metadata } : undefined;

const cloneRetryPolicy = (
  policy: CreateWebhookSubscriptionInput["retryPolicy"],
): CreateWebhookSubscriptionInput["retryPolicy"] =>
  policy
    ? {
        maxAttempts: policy.maxAttempts,
        backoffSeconds: [...policy.backoffSeconds],
        deadLetterUri: policy.deadLetterUri,
      }
    : undefined;

const toSubscriptionRecord = (
  input: CreateWebhookSubscriptionInput & { id: string; createdAt: string; updatedAt: string },
): WebhookSubscriptionRecord => ({
  id: input.id,
  orgId: input.orgId ?? undefined,
  eventTypes: [...input.eventTypes],
  targetUrl: input.targetUrl,
  secret: input.secret,
  headers: cloneHeaders(input.headers ?? {}),
  retryPolicy: cloneRetryPolicy(input.retryPolicy),
  active: input.active ?? true,
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
  metadata: cloneMetadata(input.metadata),
});

class FakeWebhookSubscriptionStore implements WebhookSubscriptionStorePort {
  private readonly records = new Map<string, WebhookSubscriptionRecord>();

  constructor() {
    const seed: WebhookSubscriptionRecord = {
      id: "sub-1",
      orgId: "org-1",
      eventTypes: ["profile.updated"],
      targetUrl: "https://example.com/webhooks/profile",
      secret: "seed-secret",
      headers: { "X-Seed": "true" },
      retryPolicy: {
        maxAttempts: 3,
        backoffSeconds: [5, 30, 300],
        deadLetterUri: "https://example.com/dlq",
      },
      active: true,
      createdAt: new Date(2024, 0, 1).toISOString(),
      updatedAt: new Date(2024, 0, 1).toISOString(),
      metadata: { tier: "gold" },
    };
    this.records.set(seed.id, seed);
  }

  async createSubscription(input: CreateWebhookSubscriptionInput) {
    const now = input.createdAt ?? new Date().toISOString();
    const id = input.id ?? `sub-${this.records.size + 1}`;
    const record = toSubscriptionRecord({ ...input, id, createdAt: now, updatedAt: input.updatedAt ?? now });
    this.records.set(id, record);
    return ok(record);
  }

  async updateSubscription(id: string, input: UpdateWebhookSubscriptionInput) {
    const current = this.records.get(id);
    if (!current) {
      return err({
        code: "webhook.subscription.not_found",
        message: `Subscription ${id} not found`,
      });
    }

    const next: WebhookSubscriptionRecord = {
      ...current,
      orgId: input.orgId === undefined ? current.orgId : input.orgId ?? undefined,
      eventTypes: input.eventTypes ? [...input.eventTypes] : current.eventTypes,
      targetUrl: input.targetUrl ?? current.targetUrl,
      secret: input.secret ?? current.secret,
      headers:
        input.headers === undefined
          ? current.headers
          : input.headers === null
            ? {}
            : cloneHeaders(input.headers),
      retryPolicy:
        input.retryPolicy === undefined
          ? current.retryPolicy
          : input.retryPolicy === null
            ? undefined
            : cloneRetryPolicy(input.retryPolicy),
      metadata:
        input.metadata === undefined
          ? current.metadata
          : input.metadata === null
            ? undefined
            : cloneMetadata(input.metadata),
      active: input.active ?? current.active,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };

    this.records.set(id, next);
    return ok(next);
  }

  async getSubscription(id: string) {
    return ok(this.records.get(id));
  }

  async listSubscriptions(options?: { orgId?: string | null; active?: boolean; eventType?: string }) {
    const values = Array.from(this.records.values()).filter((record) => {
      if (options?.orgId !== undefined) {
        if (options.orgId === null) {
          if (record.orgId) {
            return false;
          }
        } else if (record.orgId !== options.orgId) {
          return false;
        }
      }

      if (options?.active !== undefined && record.active !== options.active) {
        return false;
      }

      if (options?.eventType && !record.eventTypes.includes(options.eventType)) {
        return false;
      }

      return true;
    });
    return ok(values);
  }

  async deleteSubscription(id: string) {
    this.records.delete(id);
    return ok(undefined);
  }
}

const toDeliveryRecord = (
  input: CreateWebhookDeliveryInput & { id: string; createdAt: string; updatedAt: string },
): WebhookDeliveryRecord => ({
  id: input.id,
  subscriptionId: input.subscriptionId,
  eventId: input.eventId,
  status: input.status ?? "pending",
  attemptCount: input.attemptCount ?? 0,
  lastAttemptAt: input.lastAttemptAt ?? undefined,
  nextAttemptAt: input.nextAttemptAt ?? undefined,
  payload: { ...input.payload },
  response: input.response ? { ...input.response } : undefined,
  errorMessage: input.errorMessage ?? undefined,
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
});

const compareIso = (left: string, right: string): boolean => left <= right;

class FakeWebhookDeliveryStore implements WebhookDeliveryStorePort {
  private readonly records = new Map<string, WebhookDeliveryRecord>();

  constructor() {
    const now = new Date(2024, 0, 1, 12).toISOString();
    const record: WebhookDeliveryRecord = {
      id: "del-1",
      subscriptionId: "sub-1",
      eventId: "evt-1",
      status: "pending",
      attemptCount: 0,
      lastAttemptAt: undefined,
      nextAttemptAt: new Date(2024, 0, 1, 13).toISOString(),
      payload: { type: "profile.updated" },
      response: undefined,
      errorMessage: undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
  }

  async createDelivery(input: CreateWebhookDeliveryInput) {
    const now = input.createdAt ?? new Date().toISOString();
    const id = input.id ?? `del-${this.records.size + 1}`;
    const record = toDeliveryRecord({ ...input, id, createdAt: now, updatedAt: input.updatedAt ?? now });
    this.records.set(id, record);
    return ok(record);
  }

  async updateDelivery(id: string, input: UpdateWebhookDeliveryInput) {
    const current = this.records.get(id);
    if (!current) {
      return err({
        code: "webhook.delivery.not_found",
        message: `Delivery ${id} not found`,
      });
    }

    const next: WebhookDeliveryRecord = {
      ...current,
      status: (input.status as WebhookDeliveryStatus | undefined) ?? current.status,
      attemptCount: input.attemptCount ?? current.attemptCount,
      lastAttemptAt:
        input.lastAttemptAt === undefined ? current.lastAttemptAt : input.lastAttemptAt ?? undefined,
      nextAttemptAt:
        input.nextAttemptAt === undefined ? current.nextAttemptAt : input.nextAttemptAt ?? undefined,
      response:
        input.response === undefined
          ? current.response
          : input.response === null
            ? undefined
            : { ...input.response },
      errorMessage:
        input.errorMessage === undefined
          ? current.errorMessage
          : input.errorMessage === null
            ? undefined
            : input.errorMessage,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };

    this.records.set(id, next);
    return ok(next);
  }

  async getDelivery(id: string) {
    return ok(this.records.get(id));
  }

  async listDeliveries(options?: ListWebhookDeliveriesOptions) {
    const values = Array.from(this.records.values()).filter((record) => {
      if (options?.subscriptionId && record.subscriptionId !== options.subscriptionId) {
        return false;
      }
      if (options?.eventId && record.eventId !== options.eventId) {
        return false;
      }
      if (options?.status && record.status !== options.status) {
        return false;
      }
      return true;
    });

    const limited = options?.limit ? values.slice(0, options.limit) : values;
    return ok(limited);
  }

  async listPendingDeliveries(options?: ListPendingDeliveriesOptions) {
    const threshold = options?.before ?? new Date().toISOString();
    const values = Array.from(this.records.values()).filter((record) => {
      if (record.status !== "pending") {
        return false;
      }
      if (!record.nextAttemptAt) {
        return true;
      }
      return compareIso(record.nextAttemptAt, threshold);
    });
    const limited = options?.limit ? values.slice(0, options.limit) : values;
    return ok(limited);
  }

  async deleteDelivery(id: string) {
    this.records.delete(id);
    return ok(undefined);
  }
}

describe("@catalyst-auth/sdk", () => {
  const createSdk = () => {
    const profileStore = createInMemoryProfileStore({
      initialUsers: [
        {
          id: "user-1",
          authentikId: "auth-1",
          email: "user@example.com",
          displayName: "User One",
          primaryOrgId: "org-1",
          labels: { plan: "pro" },
        },
      ],
      initialOrgs: [
        {
          id: "org-1",
          slug: "acme",
          status: "active",
          ownerUserId: "user-1",
          profile: { name: "Acme Inc" },
          labels: {},
          settings: {},
        },
      ],
      initialMemberships: [
        {
          id: "m-1",
          userId: "user-1",
          orgId: "org-1",
          role: "owner",
          groupIds: [],
          labelsDelta: {},
          createdAt: new Date(2024, 0, 1).toISOString(),
          updatedAt: new Date(2024, 0, 1).toISOString(),
        },
      ],
    });

    const webhookSubscriptionStore = new FakeWebhookSubscriptionStore();
    const webhookDeliveryStore = new FakeWebhookDeliveryStore();

    return createCatalystSdk({
      idp: new FakeIdpAdapter(),
      profileStore,
      keyStore: createMemoryKeyStore(),
      entitlementStore: new FakeEntitlementStore(),
      sessionStore: new FakeSessionStore(),
      webhookDelivery: createMemoryWebhookDelivery({
        httpClient: async () => ({ status: 200, ok: true }),
      }),
      webhookSubscriptionStore,
      webhookDeliveryStore,
      tokenService: new FakeTokenService(),
    });
  };

  describe("auth module", () => {
    it("exchanges authorization code", async () => {
      const sdk = createSdk();
      const result = await sdk.auth.signInWithCode({
        code: "good-code",
        clientId: "client-1",
        redirectUri: "https://example.com/callback",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe("access-good");
      }
    });

    it("fails validation for sign in", async () => {
      const sdk = createSdk();
      const result = await sdk.auth.signInWithCode({
        // @ts-expect-error testing runtime validation
        code: "",
        clientId: "client-1",
        redirectUri: "https://example.com/callback",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.validation_failed");
      }
    });

    it("verifies sessions", async () => {
      const sdk = createSdk();
      const result = await sdk.auth.verifySession({ userId: "user-1", sessionId: "sess-1" });
      expect(result.ok).toBe(true);
    });

    it("returns error when session missing", async () => {
      const sdk = createSdk();
      const result = await sdk.auth.verifySession({ userId: "user-1", sessionId: "missing" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.not_found");
      }
    });

    it("signs out with token validation", async () => {
      const sdk = createSdk();
      const result = await sdk.auth.signOut({
        userId: "user-1",
        sessionId: "sess-1",
        accessToken: "access-good",
      });
      expect(result.ok).toBe(true);
    });

    it("mints decision tokens", async () => {
      const sdk = createSdk();
      const identity = await sdk.me.getEffectiveIdentity({ userId: "user-1", orgId: "org-1" });
      expect(identity.ok).toBe(true);
      if (!identity.ok) {
        throw new Error("identity lookup failed");
      }
      const result = await sdk.auth.issueDecisionToken({
        identity: identity.value,
        action: "resource.view",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.token).toBe("jwt-token");
      }
    });
  });

  describe("org module", () => {
    it("loads organizations", async () => {
      const sdk = createSdk();
      const result = await sdk.orgs.getOrgBySlug({ slug: "acme" });
      expect(result.ok).toBe(true);
    });

    it("returns not found for missing org", async () => {
      const sdk = createSdk();
      const result = await sdk.orgs.getOrgById({ orgId: "missing" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.not_found");
      }
    });
  });

  describe("keys module", () => {
    it("issues and lists keys", async () => {
      const sdk = createSdk();
      const issued = await sdk.keys.issueKey({
        hash: "hash-1",
        owner: { kind: "user", id: "user-1" },
        scopes: ["read"],
      });
      expect(issued.ok).toBe(true);
      if (!issued.ok) {
        throw new Error("failed to issue key");
      }
      const listed = await sdk.keys.listKeys({ owner: { kind: "user", id: "user-1" } });
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.length).toBe(1);
      }
    });

    it("rejects invalid key payload", async () => {
      const sdk = createSdk();
      const result = await sdk.keys.issueKey({
        // @ts-expect-error testing runtime validation
        owner: { kind: "user", id: "user-1" },
        scopes: ["read"],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.validation_failed");
      }
    });
  });

  describe("entitlements module", () => {
    it("lists existing entitlements", async () => {
      const sdk = createSdk();
      const result = await sdk.entitlements.listEntitlements({
        subject: { kind: "user", id: "user-1" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        expect(result.value[0].entitlement).toBe("feature:basic");
      }
    });

    it("upserts entitlements", async () => {
      const sdk = createSdk();
      const upserted = await sdk.entitlements.upsertEntitlement({
        entitlement: {
          id: "ent-2",
          subjectKind: "org",
          subjectId: "org-1",
          entitlement: "feature:advanced",
          createdAt: new Date(2024, 0, 3).toISOString(),
        },
      });
      expect(upserted.ok).toBe(true);
      const listed = await sdk.entitlements.listEntitlements({ subject: { kind: "org", id: "org-1" } });
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.map((item) => item.entitlement)).toContain("feature:advanced");
      }
    });

    it("validates entitlement payloads", async () => {
      const sdk = createSdk();
      const result = await sdk.entitlements.upsertEntitlement({
        entitlement: {
          id: "",
          subjectKind: "user",
          subjectId: "user-1",
          entitlement: "feature:invalid",
          createdAt: new Date().toISOString(),
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.validation_failed");
      }
    });
  });

  describe("sessions module", () => {
    it("creates, touches, and lists sessions", async () => {
      const sdk = createSdk();
      const created = await sdk.sessions.createSession({
        session: {
          id: "sess-2",
          userId: "user-1",
          createdAt: new Date(2024, 0, 4).toISOString(),
          lastSeenAt: new Date(2024, 0, 4, 1).toISOString(),
          factorsVerified: ["password"],
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) {
        throw new Error("failed to create session");
      }
      const touched = await sdk.sessions.touchSession({
        sessionId: "sess-2",
        update: { lastSeenAt: new Date(2024, 0, 4, 2).toISOString(), metadata: { ip: "127.0.0.1" } },
      });
      expect(touched.ok).toBe(true);
      if (touched.ok) {
        expect(touched.value.metadata?.ip).toBe("127.0.0.1");
      }
      const listed = await sdk.sessions.listSessions({ userId: "user-1" });
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.some((session) => session.id === "sess-2")).toBe(true);
      }
    });

    it("reports missing sessions", async () => {
      const sdk = createSdk();
      const result = await sdk.sessions.getSession({ sessionId: "missing" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.not_found");
      }
    });

    it("validates session identifiers", async () => {
      const sdk = createSdk();
      const result = await sdk.sessions.getSession({
        // @ts-expect-error runtime validation
        sessionId: "",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.validation_failed");
      }
    });
  });

  describe("webhooks module", () => {
    it("delivers events", async () => {
      const sdk = createSdk();
      const result = await sdk.webhooks.deliverEvent({
        event: {
          id: "evt-1",
          type: "user.created",
          occurredAt: new Date().toISOString(),
          data: { userId: "user-1" },
        },
        endpoint: {
          id: "wh-1",
          url: "https://example.com/webhook",
          secret: "secret",
          eventTypes: ["user.created"],
        },
      });
      expect(result.ok).toBe(true);
    });

    it("validates webhook payloads", async () => {
      const sdk = createSdk();
      const result = await sdk.webhooks.deliverEvent({
        event: {
          id: "evt-1",
          type: "user.created",
          occurredAt: new Date().toISOString(),
          data: { userId: "user-1" },
        },
        endpoint: {
          id: "wh-1",
          // @ts-expect-error testing runtime validation
          url: "not-a-url",
          secret: "secret",
          eventTypes: ["user.created"],
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.validation_failed");
      }
    });
  });

  describe("webhook subscriptions module", () => {
    it("creates and lists subscriptions", async () => {
      const sdk = createSdk();
      const createResult = await sdk.webhookSubscriptions.createSubscription({
        subscription: {
          id: "sub-created",
          orgId: "org-1",
          eventTypes: ["org.updated"],
          targetUrl: "https://example.com/orgs",
          secret: "create-secret",
          headers: { Authorization: "Bearer token" },
          metadata: { region: "us" },
        },
      });
      expect(createResult.ok).toBe(true);

      const listResult = await sdk.webhookSubscriptions.listSubscriptions({ eventType: "org.updated" });
      expect(listResult.ok).toBe(true);
      if (listResult.ok) {
        expect(listResult.value.some((record) => record.id === "sub-created")).toBe(true);
      }
    });

    it("validates subscription payloads", async () => {
      const sdk = createSdk();
      const result = await sdk.webhookSubscriptions.createSubscription({
        subscription: {
          // @ts-expect-error testing runtime validation
          eventTypes: [],
          targetUrl: "invalid", // invalid url
          secret: "", // empty secret should fail
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.validation_failed");
      }
    });
  });

  describe("webhook deliveries module", () => {
    it("lists and updates deliveries", async () => {
      const sdk = createSdk();
      const pending = await sdk.webhookDeliveries.listPendingDeliveries({
        before: new Date(2024, 0, 1, 14).toISOString(),
      });
      expect(pending.ok).toBe(true);
      if (!pending.ok) {
        throw new Error("pending deliveries lookup failed");
      }
      expect(pending.value.length).toBeGreaterThan(0);

      const update = await sdk.webhookDeliveries.updateDelivery({
        id: pending.value[0]!.id,
        changes: {
          status: "succeeded",
          response: { status: 200 },
          updatedAt: new Date().toISOString(),
        },
      });
      expect(update.ok).toBe(true);

      const listed = await sdk.webhookDeliveries.listDeliveries({ status: "succeeded" });
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.some((record) => record.status === "succeeded")).toBe(true);
      }
    });

    it("validates delivery updates", async () => {
      const sdk = createSdk();
      const result = await sdk.webhookDeliveries.updateDelivery({
        id: "del-1",
        changes: {
          // @ts-expect-error testing runtime validation
          attemptCount: -1,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("sdk.validation_failed");
      }
    });
  });

  describe("me module", () => {
    it("computes effective identity", async () => {
      const sdk = createSdk();
      const result = await sdk.me.getEffectiveIdentity({ userId: "user-1", orgId: "org-1" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.userId).toBe("user-1");
      }
    });
  });
});
