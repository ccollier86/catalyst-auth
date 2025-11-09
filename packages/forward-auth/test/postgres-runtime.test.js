import test from "node:test";
import assert from "node:assert";

import { createTestPostgresDataSource } from "@catalyst-auth/data-postgres";
import { createPostgresForwardAuthRuntime } from "@catalyst-auth/forward-auth";

const ok = (value) => ({ ok: true, value });

test("createPostgresForwardAuthRuntime composes service with data source", async () => {
  const dataSource = await createTestPostgresDataSource();
  let currentTime = new Date("2024-03-10T09:15:00.000Z");
  let sessionFetches = 0;

  const idp = {
    async validateAccessToken(token) {
      assert.strictEqual(token, "token-1");
      return ok({ active: true, subject: "user-abc" });
    },
    async buildEffectiveIdentity(userId) {
      assert.strictEqual(userId, "user-abc");
      return ok({
        userId,
        sessionId: "session-abc",
        groups: [],
        labels: {},
        roles: [],
        entitlements: [],
        scopes: [],
      });
    },
    async listActiveSessions(userId) {
      sessionFetches += 1;
      assert.strictEqual(userId, "user-abc");
      return ok([
        {
          id: "session-abc",
          userId,
          createdAt: "2024-03-09T21:00:00.000Z",
          lastSeenAt: "2024-03-10T07:00:00.000Z",
          factorsVerified: ["password"],
          metadata: { authentik: { city: "Toronto" } },
        },
      ]);
    },
  };

  const policyEngine = {
    async evaluate({ identity }) {
      assert.strictEqual(identity.userId, "user-abc");
      return ok({ allow: true });
    },
  };

  const { service, dataSource: runtimeDataSource } = createPostgresForwardAuthRuntime({
    idp,
    policyEngine,
    dataSource,
    forwardAuth: {
      now: () => new Date(currentTime),
    },
  });

  assert.strictEqual(runtimeDataSource, dataSource);

  const response = await service.handle({
    method: "get",
    path: "/team",
    headers: {
      authorization: "Bearer token-1",
      "x-forwarded-for": "198.51.100.5",
      "x-forwarded-host": "service.example.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.strictEqual(response.status, 200);

  const stored = await dataSource.sessionStore.getSession("session-abc");
  assert.ok(stored);
  assert.strictEqual(stored.createdAt, "2024-03-09T21:00:00.000Z");
  assert.strictEqual(stored.lastSeenAt, currentTime.toISOString());
  assert.strictEqual(stored.metadata.forwardAuth.host, "service.example.com");
  assert.strictEqual(stored.metadata.authentik.city, "Toronto");
  assert.strictEqual(sessionFetches, 1);

  currentTime = new Date("2024-03-10T10:00:00.000Z");

  await service.handle({
    method: "get",
    path: "/team",
    headers: {
      authorization: "Bearer token-1",
      "x-forwarded-for": "198.51.100.5",
    },
  });

  const touched = await dataSource.sessionStore.getSession("session-abc");
  assert.strictEqual(touched.lastSeenAt, currentTime.toISOString());
  assert.strictEqual(sessionFetches, 1);
});
