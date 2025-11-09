import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { buildTraefikForwardAuthConfig } from "@catalyst-auth/forward-auth";

const snapshotDir = fileURLToPath(new URL("./__snapshots__", import.meta.url));

const assertSnapshot = (name, value) => {
  const snapshotPath = path.join(snapshotDir, `${name}.json`);
  assert.ok(existsSync(snapshotPath), `Snapshot missing for ${name}`);
  const expected = readFileSync(snapshotPath, "utf-8");
  const actual = `${JSON.stringify(value, null, 2)}\n`;
  assert.strictEqual(actual, expected);
};

test("builds forward-auth labels with decision routes", () => {
  const config = buildTraefikForwardAuthConfig({
    serviceName: "app-service",
    forwardAuthUrl: "http://forward-auth:3001/forward-auth",
    hosts: ["app.example.com", "app.staging.example.com"],
    entryPoints: ["websecure"],
    authResponseHeaders: ["x-user-sub", "x-decision-jwt"],
    decisionRoutes: [
      {
        pathPrefix: "/_catalyst/decision/jwks",
        upstreamUrl: "http://forward-auth:3001/decision/jwks",
      },
      {
        name: "app-service-decision-cache",
        pathPrefix: "/_catalyst/decision/cache",
        upstreamUrl: "http://forward-auth:3001/decision/cache",
        entryPoints: ["internal"],
        middlewares: ["auth-basic"],
      },
    ],
  });

  assertSnapshot("traefik-config-with-decisions", config);
});

test("allows overriding middleware and headers", () => {
  const config = buildTraefikForwardAuthConfig({
    serviceName: "docs",
    routerName: "docs-router",
    middlewareName: "docs-forward",
    forwardAuthUrl: "http://forward:8080/auth",
    hosts: "docs.example.com",
    trustForwardHeader: false,
    extraMiddlewares: ["gzip", "secure-headers"],
    authResponseHeaders: ["x-user", "x-org"],
  });

  assertSnapshot("traefik-config-custom", config);
});
