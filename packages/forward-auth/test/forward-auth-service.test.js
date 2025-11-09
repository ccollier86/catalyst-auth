import test from "node:test";
import assert from "node:assert";

import { createTestPostgresDataSource } from "@catalyst-auth/data-postgres";
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
  const dataSource = await createTestPostgresDataSource();
  const cache = createCacheStub();
  let validationCalls = 0;
  let sessionFetches = 0;

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
    async listActiveSessions(userId) {
      sessionFetches += 1;
      assert.strictEqual(userId, "user-1");
      return ok([
        {
          id: "session-1",
          userId,
          createdAt: "2024-01-01T00:00:00.000Z",
          lastSeenAt: "2024-01-01T00:00:00.000Z",
          factorsVerified: ["password"],
          metadata: { source: "idp" },
        },
      ]);
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
    {
      decisionCache: cache,
      decisionCacheTtlSeconds: 30,
      auditLog: dataSource.auditLog,
      sessionStore: dataSource.sessionStore,
    },
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
  assert.strictEqual(sessionFetches, 1);

  const cachedEntry = await cache.get("forward-auth:decision:decision.jwt");
  assert.ok(cachedEntry, "decision JWT should be cached");

  const auditEvents = await dataSource.listAuditEvents();
  assert.strictEqual(auditEvents.length, 1, "audit event should be recorded for cached decision");
  assert.strictEqual(auditEvents[0].action, "decision_cached");
  assert.strictEqual(auditEvents[0].resource?.id, "decision.jwt");
  assert.deepEqual(auditEvents[0].metadata?.groups, ["engineering"]);

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
  const sessionRecord = await dataSource.sessionStore.getSession("session-1");
  assert.ok(sessionRecord);
  assert.strictEqual(sessionRecord.userId, "user-1");
  assert.strictEqual(sessionRecord.factorsVerified[0], "password");
});

test("persists session activity with metadata in Postgres", async () => {
  const dataSource = await createTestPostgresDataSource();
  const cache = createCacheStub();
  let validationCalls = 0;
  let sessionFetches = 0;
  let currentTime = new Date("2024-02-01T12:00:00.000Z");

  const idp = {
    async validateAccessToken(token) {
      validationCalls += 1;
      assert.strictEqual(token, "access-token");
      return ok({ active: true, subject: "user-42" });
    },
    async buildEffectiveIdentity(userId) {
      assert.strictEqual(userId, "user-42");
      return ok({
        userId,
        sessionId: "session-xyz",
        groups: [],
        labels: {},
        roles: [],
        entitlements: [],
        scopes: [],
      });
    },
    async listActiveSessions(userId) {
      sessionFetches += 1;
      assert.strictEqual(userId, "user-42");
      return ok([
        {
          id: "session-xyz",
          userId,
          createdAt: "2024-02-01T10:00:00.000Z",
          lastSeenAt: "2024-02-01T11:30:00.000Z",
          factorsVerified: ["password", "totp"],
          metadata: { authentik: { device: "mac" } },
        },
      ]);
    },
  };

  const policyEngine = {
    async evaluate({ identity, action }) {
      assert.strictEqual(identity.userId, "user-42");
      assert.strictEqual(action, "GET /space");
      return ok({ allow: true, decisionJwt: "decision.jwt" });
    },
  };

  const service = new ForwardAuthService(
    { idp, policyEngine },
    {
      decisionCache: cache,
      auditLog: dataSource.auditLog,
      sessionStore: dataSource.sessionStore,
      now: () => new Date(currentTime),
    },
  );

  const firstResponse = await service.handle({
    method: "get",
    path: "/space",
    headers: {
      authorization: "Bearer access-token",
      "user-agent": "unit-test",
      "x-forwarded-for": "203.0.113.1, 10.0.0.1",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.strictEqual(firstResponse.status, 200);

  const created = await dataSource.sessionStore.getSession("session-xyz");
  assert.ok(created);
  assert.strictEqual(created.createdAt, "2024-02-01T10:00:00.000Z");
  assert.strictEqual(created.lastSeenAt, currentTime.toISOString());
  assert.deepStrictEqual(created.factorsVerified, ["password", "totp"]);
  assert.strictEqual(created.metadata.authentik.device, "mac");
  assert.strictEqual(created.metadata.forwardAuth.ip, "203.0.113.1");
  assert.strictEqual(created.metadata.forwardAuth.host, "app.example.com");
  assert.strictEqual(sessionFetches, 1);

  currentTime = new Date("2024-02-01T12:30:00.000Z");

  const secondResponse = await service.handle({
    method: "get",
    path: "/space",
    headers: {
      authorization: "Bearer access-token",
      "user-agent": "unit-test",
      "x-forwarded-for": "203.0.113.1",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.strictEqual(secondResponse.status, 200);

  const touched = await dataSource.sessionStore.getSession("session-xyz");
  assert.ok(touched);
  assert.strictEqual(touched.lastSeenAt, currentTime.toISOString());
  assert.strictEqual(touched.metadata.authentik.device, "mac");
  assert.deepStrictEqual(touched.metadata.forwardAuth.ip, "203.0.113.1");
  assert.strictEqual(sessionFetches, 1, "should reuse stored session after creation");
  assert.strictEqual(validationCalls, 2);
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
  const dataSource = await createTestPostgresDataSource();
  const keySecret = "key-secret";
  const hash = defaultHashApiKey(keySecret);
  const nowIso = new Date().toISOString();
  await dataSource.seed({
    keys: [
      {
        id: "key-1",
        hash,
        owner: { kind: "user", id: "user-55" },
        name: "Test key",
        description: "",
        createdBy: { kind: "system", id: "seed" },
        createdAt: nowIso,
        updatedAt: nowIso,
        usageCount: 0,
        status: "active",
        scopes: ["read"],
        labels: { tier: "gold" },
      },
    ],
  });

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

  const service = new ForwardAuthService(
    { idp, policyEngine },
    { keyStore: dataSource.keyStore, hashApiKey: defaultHashApiKey },
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
  const updatedKeyResult = await dataSource.keyStore.getKeyById("key-1");
  assert.ok(updatedKeyResult.ok);
  assert.strictEqual(updatedKeyResult.value?.usageCount, 1, "key usage should be recorded");
  assert.ok(updatedKeyResult.value?.lastUsedAt, "lastUsedAt should be set when key is used");
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
  const dataSource = await createTestPostgresDataSource();

  const service = new ForwardAuthService(
    { idp, policyEngine },
    { keyStore: dataSource.keyStore, hashApiKey: defaultHashApiKey },
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
