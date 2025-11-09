import test from "node:test";
import assert from "node:assert";

import { ForwardAuthService, defaultHashApiKey } from "@catalyst-auth/forward-auth";

const ok = (value) => ({ ok: true, value });

const createCacheStub = () => {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
};

test("allows requests with valid access tokens and caches decision JWTs", async () => {
  const cache = createCacheStub();
  let validationCalls = 0;

  const idp = {
    async validateAccessToken(token) {
      validationCalls += 1;
      assert.strictEqual(token, "access-123");
      return ok({ active: true, subject: "user-1" });
    },
    async buildEffectiveIdentity(userId, orgId) {
      assert.strictEqual(userId, "user-1");
      assert.strictEqual(orgId, "org-9");
      return ok({
        userId,
        orgId,
        sessionId: "session-1",
        groups: ["engineering"],
        labels: { plan: "pro" },
        roles: ["admin"],
        entitlements: ["feature:a"],
        scopes: ["read", "write"],
      });
    },
  };

  const policyEngine = {
    async evaluate({ identity, action, resource, environment }) {
      assert.strictEqual(identity.userId, "user-1");
      assert.strictEqual(action, "GET /space" );
      assert.strictEqual(resource, undefined);
      assert.strictEqual(environment, undefined);
      return ok({
        allow: true,
        reason: "granted",
        decisionJwt: "decision.jwt",
        obligations: { audit: true },
      });
    },
  };

  const service = new ForwardAuthService(
    { idp, policyEngine },
    { decisionCache: cache, decisionCacheTtlSeconds: 30 },
  );

  const response = await service.handle({
    method: "get",
    path: "/space",
    headers: {
      authorization: "Bearer access-123",
      "x-catalyst-org": "org-9",
    },
  });

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers["x-user-sub"], "user-1");
  assert.strictEqual(response.headers["x-org-id"], "org-9");
  assert.strictEqual(response.headers["x-decision-jwt"], "decision.jwt");
  assert.strictEqual(response.headers["x-policy-obligations"], JSON.stringify({ audit: true }));
  assert.strictEqual(validationCalls, 1);

  const cachedEntry = await cache.get("forward-auth:decision:decision.jwt");
  assert.ok(cachedEntry, "decision JWT should be cached");

  const cachedResponse = await service.handle({
    method: "get",
    path: "/space",
    headers: {
      "x-decision-jwt": "decision.jwt",
    },
  });

  assert.strictEqual(cachedResponse.status, 200);
  assert.strictEqual(cachedResponse.headers["x-decision-jwt"], "decision.jwt");
  assert.strictEqual(validationCalls, 1, "cache should short-circuit token validation");
});

test("returns unauthorized when token is inactive", async () => {
  const idp = {
    async validateAccessToken() {
      return ok({ active: false });
    },
    async buildEffectiveIdentity() {
      throw new Error("should not be called");
    },
  };

  const policyEngine = {
    async evaluate() {
      throw new Error("should not evaluate policy for inactive tokens");
    },
  };

  const service = new ForwardAuthService({ idp, policyEngine });

  const response = await service.handle({
    method: "get",
    path: "/space",
    headers: { authorization: "Bearer token" },
  });

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.headers["x-forward-auth-error"], "inactive_token");
});

test("returns forbidden when policy denies", async () => {
  const idp = {
    async validateAccessToken() {
      return ok({ active: true, subject: "user-1" });
    },
    async buildEffectiveIdentity() {
      return ok({
        userId: "user-1",
        groups: [],
        labels: {},
        roles: [],
        entitlements: [],
        scopes: [],
      });
    },
  };

  const policyEngine = {
    async evaluate() {
      return ok({ allow: false, reason: "nope" });
    },
  };

  const service = new ForwardAuthService({ idp, policyEngine });

  const response = await service.handle({
    method: "post",
    path: "/secure",
    headers: { authorization: "Bearer token" },
  });

  assert.strictEqual(response.status, 403);
  assert.strictEqual(response.headers["x-forward-auth-error"], "nope");
});

test("exchanges API keys for merged identities and records usage", async () => {
  const usedAt = [];
  const keySecret = "key-secret";
  const hash = defaultHashApiKey(keySecret);
  const keyRecord = {
    id: "key-1",
    hash,
    owner: { kind: "user", id: "user-55" },
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
    scopes: ["read"],
    labels: { tier: "gold" },
  };

  const idp = {
    async validateAccessToken() {
      throw new Error("should not validate token for API keys");
    },
    async buildEffectiveIdentity(userId) {
      assert.strictEqual(userId, "user-55");
      return ok({
        userId,
        orgId: "org-77",
        sessionId: undefined,
        groups: ["billing"],
        labels: { plan: "starter" },
        roles: ["member"],
        entitlements: ["usage:read"],
        scopes: ["base"],
      });
    },
  };

  const policyEngine = {
    async evaluate() {
      return ok({ allow: true });
    },
  };

  const keyStore = {
    async getKeyByHash(candidate) {
      assert.strictEqual(candidate, hash);
      return ok(keyRecord);
    },
    async recordKeyUsage(id, { usedAt: timestamp }) {
      usedAt.push({ id, timestamp });
      return ok({ ...keyRecord, usageCount: keyRecord.usageCount + 1, lastUsedAt: timestamp });
    },
  };

  const service = new ForwardAuthService(
    { idp, policyEngine },
    { keyStore, hashApiKey: defaultHashApiKey },
  );

  const response = await service.handle({
    method: "get",
    path: "/resource",
    orgId: "org-override",
    headers: {
      "x-api-key": keySecret,
    },
  });

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers["x-user-sub"], "user-55");
  assert.strictEqual(JSON.parse(response.headers["x-user-labels"]).tier, "gold");
  assert.ok(response.headers["x-user-scopes"].includes("base"));
  assert.ok(response.headers["x-user-scopes"].includes("read"));
  assert.strictEqual(usedAt.length, 1, "key usage should be recorded");
});

test("returns unauthorized when API key not found", async () => {
  const idp = {
    async validateAccessToken() {
      throw new Error("should not validate token for API keys");
    },
    async buildEffectiveIdentity() {
      throw new Error("should not build identity for missing keys");
    },
  };

  const policyEngine = {
    async evaluate() {
      throw new Error("should not evaluate policy when key is invalid");
    },
  };

  const keyStore = {
    async getKeyByHash() {
      return ok(undefined);
    },
    async recordKeyUsage() {
      throw new Error("should not record usage for missing keys");
    },
  };

  const service = new ForwardAuthService(
    { idp, policyEngine },
    { keyStore, hashApiKey: defaultHashApiKey },
  );

  const response = await service.handle({
    method: "get",
    path: "/resource",
    headers: {
      "x-api-key": "missing",
    },
  });

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.headers["x-forward-auth-error"], "invalid_api_key");
});
