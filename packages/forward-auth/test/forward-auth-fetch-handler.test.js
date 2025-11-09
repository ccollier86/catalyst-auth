import test from "node:test";
import assert from "node:assert";

import { createForwardAuthFetchHandler } from "@catalyst-auth/forward-auth";

const collectRequests = () => {
  const calls = [];
  return {
    calls,
    service: {
      async handle(request) {
        calls.push(request);
        return {
          status: 200,
          headers: { "x-allowed": "true", "x-decision-jwt": "jwt-1" },
        };
      },
    },
  };
};

test("adapts Traefik forward-auth headers into ForwardAuthRequest", async () => {
  const { service, calls } = collectRequests();
  const handler = createForwardAuthFetchHandler(service);

  const response = await handler(
    new Request("https://forward-auth.catalyst.local/verify", {
      method: "GET",
      headers: {
        authorization: "Bearer user-token",
        "x-forwarded-method": "POST",
        "x-forwarded-uri": "/api/data?hello=world",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
        "x-catalyst-org": "org-123",
        "x-forward-auth-env-plan": "pro",
      },
    }),
  );

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.headers.get("x-allowed"), "true");
  assert.strictEqual(response.headers.get("x-decision-jwt"), "jwt-1");

  assert.strictEqual(calls.length, 1);
  const request = calls[0];
  assert.strictEqual(request.method, "POST");
  assert.strictEqual(request.path, "/api/data?hello=world");
  assert.strictEqual(request.orgId, "org-123");
  assert.deepStrictEqual(request.environment, { plan: "pro" });
  assert.deepStrictEqual(request.resource, {
    type: "http",
    id: "https://app.example.com/api/data?hello=world",
    attributes: {
      host: "app.example.com",
      path: "/api/data?hello=world",
      method: "POST",
      protocol: "https",
    },
  });
  assert.strictEqual(request.headers.authorization, "Bearer user-token");
});

test("merges environment and overrides through handler options", async () => {
  const calls = [];
  const handler = createForwardAuthFetchHandler(
    {
      async handle(request) {
        calls.push(request);
        return { status: 200, headers: {} };
      },
    },
    {
      environmentHeaderPrefix: "x-env-",
      buildEnvironment: ({ headers }) => ({ region: headers["x-region"] ?? "us" }),
      buildAction: ({ headers }) => `${headers["x-forwarded-method"]}:${headers["x-forwarded-uri"]}`,
      buildResource: ({ url }) => ({ type: "service", id: url.hostname }),
    },
  );

  await handler(
    new Request("http://forward-auth.internal/forward", {
      method: "HEAD",
      headers: {
        "x-forwarded-method": "DELETE",
        "x-forwarded-uri": "/v1/keys/123",
        "x-env-plan": "enterprise",
        "x-region": "eu", // consumed by custom buildEnvironment
      },
    }),
  );

  assert.strictEqual(calls.length, 1);
  const request = calls[0];
  assert.strictEqual(request.method, "DELETE");
  assert.strictEqual(request.path, "/v1/keys/123");
  assert.strictEqual(request.action, "DELETE:/v1/keys/123");
  assert.deepStrictEqual(request.environment, { plan: "enterprise", region: "eu" });
  assert.deepStrictEqual(request.resource, { type: "service", id: "forward-auth.internal" });
});

test("propagates error responses from the service", async () => {
  const handler = createForwardAuthFetchHandler({
    async handle() {
      return {
        status: 401,
        headers: { "x-forward-auth-error": "missing_credentials" },
        body: "Denied",
      };
    },
  });

  const response = await handler(new Request("http://forward/deny", { method: "GET" }));

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.headers.get("x-forward-auth-error"), "missing_credentials");
  assert.strictEqual(await response.text(), "Denied");
});
