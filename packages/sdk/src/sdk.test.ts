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

    return createCatalystSdk({
      idp: new FakeIdpAdapter(),
      profileStore,
      keyStore: createMemoryKeyStore(),
      entitlementStore: new FakeEntitlementStore(),
      sessionStore: new FakeSessionStore(),
      webhookDelivery: createMemoryWebhookDelivery({
        httpClient: async () => ({ status: 200, ok: true }),
      }),
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
