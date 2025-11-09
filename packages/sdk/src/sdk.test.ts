import { describe, expect, it } from "vitest";

import {
  err,
  ok,
  type CatalystError,
  type EffectiveIdentity,
  type IdpAdapterPort,
  type IdpUserProfile,
  type JwtDescriptor,
  type MintDecisionJwtInput,
  type Result,
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
