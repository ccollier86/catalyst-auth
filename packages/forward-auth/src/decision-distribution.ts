import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

import type { ForwardAuthRequest, ForwardAuthResponse } from "./types.js";

export interface DecisionCacheWarmerOptions {
  readonly fetch: typeof fetch;
  readonly forwardAuthEndpoint: string;
  readonly requests: ReadonlyArray<DecisionWarmRequest>;
  readonly defaultHeaders?: Record<string, string>;
}

export interface DecisionWarmRequest {
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly searchParams?: Record<string, string>;
}

export interface DecisionCacheWarmResult {
  readonly request: DecisionWarmRequest;
  readonly ok: boolean;
  readonly status: number;
  readonly decisionJwt?: string;
  readonly error?: string;
}

export interface DecisionJwkInput {
  readonly algorithm: "RS256" | "EdDSA";
  readonly privateKey: string | Buffer | KeyObject;
  readonly keyId?: string;
}

export interface DecisionJwksResponseOptions {
  readonly keys: ReadonlyArray<DecisionJwkInput>;
  readonly cacheControlSeconds?: number;
}

export const createDecisionCacheWarmer = (options: DecisionCacheWarmerOptions) =>
  async (): Promise<DecisionCacheWarmResult[]> => {
    const results: DecisionCacheWarmResult[] = [];

    for (const request of options.requests) {
      const url = new URL(options.forwardAuthEndpoint);
      url.pathname = ensureLeadingSlash(request.path);
      if (request.searchParams) {
        for (const [key, value] of Object.entries(request.searchParams)) {
          url.searchParams.set(key, value);
        }
      }

      const headers = new Headers(options.defaultHeaders ?? {});
      for (const [key, value] of Object.entries(request.headers ?? {})) {
        headers.set(key, value);
      }
      headers.set("x-forwarded-method", (request.method ?? "GET").toUpperCase());
      headers.set("x-forwarded-uri", url.pathname + url.search);

      try {
        const response = await options.fetch(url, {
          method: request.method ?? "GET",
          headers,
        });
        const decisionJwt = response.headers.get("x-decision-jwt") ?? undefined;
        results.push({
          request,
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          decisionJwt,
        });
      } catch (error) {
        results.push({
          request,
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  };

export const createDecisionJwksResponse = (
  options: DecisionJwksResponseOptions,
): Response => {
  const jwks = {
    keys: options.keys.map(toPublicJwk),
  };
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": buildCacheControl(options.cacheControlSeconds ?? 300),
  });
  return new Response(JSON.stringify(jwks), { status: 200, headers });
};

export interface ForwardAuthLike {
  handle(request: ForwardAuthRequest): Promise<ForwardAuthResponse>;
}

export const warmDecisionsWithService = async (
  service: ForwardAuthLike,
  requests: ReadonlyArray<DecisionWarmRequest>,
): Promise<DecisionCacheWarmResult[]> => {
  const results: DecisionCacheWarmResult[] = [];
  for (const request of requests) {
    try {
      const response = await service.handle({
        method: (request.method ?? "GET").toLowerCase(),
        path: ensureLeadingSlash(request.path),
        headers: request.headers ?? {},
      });
      results.push({
        request,
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        decisionJwt: response.headers["x-decision-jwt"],
      });
    } catch (error) {
      results.push({
        request,
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
};

const buildCacheControl = (seconds: number): string => `public, max-age=${Math.max(0, Math.floor(seconds))}`;

const ensureLeadingSlash = (path: string): string => (path.startsWith("/") ? path : `/${path}`);

const toPublicJwk = (input: DecisionJwkInput): Record<string, unknown> => {
  const keyObject = toKeyObject(input.privateKey);
  const publicKey = keyObject.type === "private" ? createPublicKey(keyObject) : keyObject;
  const exported = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  return {
    ...exported,
    use: "sig",
    alg: input.algorithm,
    ...(input.keyId ? { kid: input.keyId } : {}),
  };
};

const toKeyObject = (key: DecisionJwkInput["privateKey"]): KeyObject => {
  if (isKeyObject(key)) {
    return key;
  }
  try {
    return createPrivateKey(key);
  } catch (error) {
    throw new Error(`Failed to parse private key: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const isKeyObject = (value: DecisionJwkInput["privateKey"]): value is KeyObject =>
  typeof value === "object" && value !== null && typeof (value as KeyObject).type === "string";
