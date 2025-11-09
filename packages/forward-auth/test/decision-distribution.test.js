import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import {
  createDecisionCacheWarmer,
  createDecisionJwksResponse,
  warmDecisionsWithService,
} from "@catalyst-auth/forward-auth";

test("decision cache warmer issues fetch requests", async () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: url.toString(), init });
    return new Response(null, {
      status: 200,
      headers: { "x-decision-jwt": "decision.jwt" },
    });
  };

  const warm = createDecisionCacheWarmer({
    fetch,
    forwardAuthEndpoint: "http://forward-auth:3001/forward-auth",
    defaultHeaders: { authorization: "Bearer access" },
    requests: [
      { path: "/space", method: "GET" },
      { path: "internal", method: "post", headers: { "x-catalyst-org": "org-9" } },
    ],
  });

  const results = await warm();
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => ({ ok: result.ok, status: result.status, token: result.decisionJwt })),
    [
      { ok: true, status: 200, token: "decision.jwt" },
      { ok: true, status: 200, token: "decision.jwt" },
    ],
  );
  assert.equal(requests[0].url, "http://forward-auth:3001/space");
  assert.equal(requests[0].init.headers.get("x-forwarded-method"), "GET");
  assert.equal(requests[1].init.headers.get("x-forwarded-method"), "POST");
  assert.equal(requests[1].init.headers.get("x-catalyst-org"), "org-9");
});

test("creates JWKS response from signing keys", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const response = createDecisionJwksResponse({
    cacheControlSeconds: 120,
    keys: [
      {
        algorithm: "EdDSA",
        privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
        keyId: "decision-1",
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "public, max-age=120");
  const jwks = JSON.parse(await response.text());
  assert.equal(jwks.keys.length, 1);
  assert.equal(jwks.keys[0].kid, "decision-1");
  assert.equal(jwks.keys[0].use, "sig");
});

test("warms decisions directly via service handle", async () => {
  const handled = [];
  const service = {
    async handle(request) {
      handled.push(request);
      return {
        status: 200,
        headers: { "x-decision-jwt": `decision-${handled.length}` },
      };
    },
  };

  const results = await warmDecisionsWithService(service, [
    { path: "/hello" },
    { path: "/goodbye", method: "POST", headers: { authorization: "Decision token" } },
  ]);

  assert.equal(results.length, 2);
  assert.equal(handled[0].path, "/hello");
  assert.equal(handled[1].method, "post");
  assert.equal(results[1].decisionJwt, "decision-2");
});
