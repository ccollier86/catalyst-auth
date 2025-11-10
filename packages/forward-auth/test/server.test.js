import assert from "node:assert/strict";
import test from "node:test";

import { createRedisCache, createRedisCacheHealthIndicator } from "@catalyst-auth/cache-redis";
import { createForwardAuthServer } from "@catalyst-auth/forward-auth";

const createServiceStub = (handler) => ({ handle: handler ?? (async () => ({ status: 204, headers: {} })) });

const createRedisClientStub = () => {
  let shouldFail = false;
  let pingCount = 0;
  const client = {
    get isOpen() {
      return true;
    },
    get isReady() {
      return true;
    },
    async ping() {
      pingCount += 1;
      if (shouldFail) {
        throw new Error("redis down");
      }
      return "PONG";
    },
    setFailure(value) {
      shouldFail = value;
    },
    getPingCount() {
      return pingCount;
    },
    async get() {
      return null;
    },
    async set() {
      return "OK";
    },
    async del() {
      return 0;
    },
    async sAdd() {
      return 0;
    },
    async sRem() {
      return 0;
    },
    async sCard() {
      return 0;
    },
    async sMembers() {
      return [];
    },
    async expire() {
      return true;
    },
  };
  return client;
};

test("forward auth server health check reports redis connectivity", async () => {
  const redisClient = createRedisClientStub();
  const cache = createRedisCache({ client: redisClient, keyPrefix: "fa" });

  const handler = createForwardAuthServer({
    service: createServiceStub(),
    cacheHealthChecks: [createRedisCacheHealthIndicator("decision", cache)],
  });

  const response = await handler(new Request("https://forward-auth.example.com/healthz"));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, {
    ok: true,
    caches: [{ name: "decision", healthy: true }],
  });
  assert.equal(redisClient.getPingCount(), 1);
});

test("forward auth server health check surfaces redis failures", async () => {
  const redisClient = createRedisClientStub();
  redisClient.setFailure(true);
  const cache = createRedisCache({ client: redisClient, keyPrefix: "fa" });

  const handler = createForwardAuthServer({
    service: createServiceStub(),
    cacheHealthChecks: [createRedisCacheHealthIndicator("decision", cache)],
  });

  const response = await handler(new Request("https://forward-auth.example.com/healthz"));
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.caches[0].name, "decision");
  assert.equal(payload.caches[0].healthy, false);
  assert.match(payload.caches[0].error, /redis down/);
  assert.equal(redisClient.getPingCount(), 1);
});

test("forward auth server records metrics for requests", async () => {
  const requestCounter = createCounterStub();
  const requestDuration = createHistogramStub();
  const handler = createForwardAuthServer({
    service: createServiceStub(async (request) => {
      assert.equal(request.method, "GET");
      assert.equal(request.path, "/allow");
      return { status: 202, headers: { "x-result": "ok" } };
    }),
    metrics: { requestCounter, requestDuration },
  });

  const response = await handler(new Request("https://forward-auth.example.com/allow"));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-result"), "ok");
  assert.equal(requestCounter.calls.length, 1);
  assert.equal(requestCounter.calls[0].value, 1);
  assert.equal(requestCounter.calls[0].attributes.status, 202);
  assert.equal(requestDuration.calls.length, 1);
  assert.equal(requestDuration.calls[0].attributes.route, "forward-auth");
});

test("forward auth server returns error response on handler failure", async () => {
  const requestCounter = createCounterStub();
  const requestDuration = createHistogramStub();

  const handler = createForwardAuthServer({
    service: createServiceStub(async () => {
      throw new Error("boom");
    }),
    metrics: { requestCounter, requestDuration },
  });

  const response = await handler(new Request("https://forward-auth.example.com/deny"));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "internal_error");
  assert.equal(requestCounter.calls[0].attributes.status, 500);
  assert.equal(requestDuration.calls[0].attributes.status, 500);
});

const createCounterStub = () => ({
  calls: [],
  add(value, attributes) {
    this.calls.push({ value, attributes });
  },
});

const createHistogramStub = () => ({
  calls: [],
  record(value, attributes) {
    this.calls.push({ value, attributes });
  },
});
