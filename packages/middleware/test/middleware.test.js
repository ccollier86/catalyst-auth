import test from "node:test";
import assert from "node:assert/strict";

import {
  createExpressForwardAuthMiddleware,
  createNextForwardAuthMiddleware,
  createElysiaForwardAuthPlugin,
} from "@catalyst-auth/middleware";

const createService = (responses) => {
  const calls = [];
  return {
    calls,
    async handle(request) {
      calls.push(request);
      const response = typeof responses === "function" ? responses(request, calls.length) : responses[calls.length - 1];
      return response;
    },
  };
};

test("express middleware decorates request on allow", async () => {
  const service = createService([
    {
      status: 200,
      headers: { "x-decision-jwt": "token-1", "x-user-sub": "user-1" },
    },
  ]);
  const headers = new Map();
  const req = {
    method: "GET",
    path: "/docs",
    headers: { authorization: "Bearer abc" },
  };
  const res = {
    statusCode: 200,
    locals: undefined,
    setHeader(name, value) {
      headers.set(name, value);
    },
    end() {
      throw new Error("end should not be called on allowed request");
    },
  };

  await new Promise((resolve, reject) => {
    const middleware = createExpressForwardAuthMiddleware(service);
    middleware(req, res, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  assert.equal(service.calls.length, 1);
  assert.equal(service.calls[0].path, "/docs");
  assert.equal(req.forwardAuth.headers["x-decision-jwt"], "token-1");
  assert.equal(res.locals.forwardAuth.headers["x-user-sub"], "user-1");
  assert.equal(headers.get("x-decision-jwt"), "token-1");
});

test("express middleware returns denial response", async () => {
  const service = createService([
    {
      status: 403,
      headers: { "x-forward-auth-error": "denied" },
      body: "forbidden",
    },
  ]);

  const calls = [];
  const res = {
    statusCode: 200,
    headers: new Map(),
    setHeader(name, value) {
      this.headers.set(name, value);
    },
    end(body) {
      calls.push(body);
    },
  };

  const req = {
    method: "POST",
    url: "https://example.com/admin",
    headers: { authorization: "Decision token" },
  };

  await new Promise((resolve) => {
    const middleware = createExpressForwardAuthMiddleware(service);
    middleware(req, res, () => {
      throw new Error("next should not be called");
    });
    setImmediate(resolve);
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.headers.get("x-forward-auth-error"), "denied");
  assert.equal(calls[0], "forbidden");
});

test("next middleware produces continuation header", async () => {
  const service = createService((request) => ({
    status: 200,
    headers: { "x-decision-jwt": `token-${request.path}` },
  }));

  const middleware = createNextForwardAuthMiddleware(service, {
    buildRequest: (request) => ({ headers: { "x-extra": request.headers.get("x-extra") ?? "" } }),
  });

  const request = new Request("https://example.com/app", {
    method: "GET",
    headers: { Authorization: "Bearer", "x-extra": "value" },
  });

  const response = await middleware(request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("x-decision-jwt"), "token-/app");
  assert.equal(service.calls[0].headers["x-extra"], "value");
});

test("elysia plugin augments context and respects denials", async () => {
  const service = createService([
    { status: 200, headers: { "x-decision-jwt": "decision-1" } },
    { status: 401, headers: { "x-forward-auth-error": "missing" }, body: "unauthorized" },
  ]);

  const plugin = createElysiaForwardAuthPlugin(service, {
    onAllow: (ctx, response) => {
      ctx.store = { ...(ctx.store ?? {}), decision: response.headers["x-decision-jwt"] };
    },
  });

  const allowContext = {
    request: new Request("https://example.com/ok"),
    set: {},
    store: {},
  };

  const allowResult = await plugin(allowContext, () => "continue");
  assert.equal(allowResult, "continue");
  assert.equal(allowContext.set.status, 200);
  assert.equal(allowContext.set.headers["x-decision-jwt"], "decision-1");
  assert.equal(allowContext.store.decision, "decision-1");

  const denyContext = {
    request: new Request("https://example.com/deny", { method: "POST" }),
    set: {},
  };

  const denyResult = await plugin(denyContext);
  assert.equal(denyContext.set.status, 401);
  assert.equal(denyContext.set.headers["x-forward-auth-error"], "missing");
  assert.equal(denyResult, "unauthorized");
});
