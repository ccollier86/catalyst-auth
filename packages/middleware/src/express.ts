import type {
  ForwardAuthRequest,
  ForwardAuthResponse,
  ForwardAuthLike,
} from "@catalyst-auth/forward-auth";

export interface ExpressRequestLike {
  method?: string;
  path?: string;
  url?: string;
  headers: Record<string, string | readonly string[] | undefined>;
  [key: string]: unknown;
}

export interface ExpressResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: unknown): void;
  locals?: Record<string, unknown>;
}

export type ExpressNextFunction = (error?: unknown) => void;

export interface ExpressForwardAuthOptions {
  readonly buildRequest?: (req: ExpressRequestLike) => Partial<ForwardAuthRequest>;
  readonly decorateRequest?: (req: ExpressRequestLike, response: ForwardAuthResponse) => void;
  readonly decorateResponse?: (res: ExpressResponseLike, response: ForwardAuthResponse) => void;
}

export const createExpressForwardAuthMiddleware = (
  service: ForwardAuthLike,
  options: ExpressForwardAuthOptions = {},
) =>
  (req: ExpressRequestLike, res: ExpressResponseLike, next: ExpressNextFunction): void => {
    void (async () => {
      const request = buildForwardAuthRequest(req, options.buildRequest);
      const decision = await service.handle(request);
      if (decision.status >= 200 && decision.status < 300) {
        applyResponseHeaders(res, decision.headers);
        if (options.decorateRequest) {
          options.decorateRequest(req, decision);
        } else {
          (req as Record<string, unknown>).forwardAuth = decision;
          res.locals = res.locals ?? {};
          res.locals.forwardAuth = decision;
        }
        options.decorateResponse?.(res, decision);
        next();
        return;
      }

      res.statusCode = decision.status;
      applyResponseHeaders(res, decision.headers);
      options.decorateResponse?.(res, decision);
      res.end(decision.body ?? "");
    })().catch(next);
  };

const buildForwardAuthRequest = (
  req: ExpressRequestLike,
  builder?: ExpressForwardAuthOptions["buildRequest"],
): ForwardAuthRequest => {
  const base: ForwardAuthRequest = {
    method: (req.method ?? "GET").toLowerCase(),
    path: derivePath(req),
    headers: flattenHeaders(req.headers),
  };
  if (!builder) {
    return base;
  }
  const overrides = builder(req);
  return {
    ...base,
    ...overrides,
    headers: {
      ...base.headers,
      ...(overrides.headers ?? {}),
    },
  };
};

const derivePath = (req: ExpressRequestLike): string => {
  if (typeof req.path === "string" && req.path.length > 0) {
    return req.path.startsWith("/") ? req.path : `/${req.path}`;
  }
  if (typeof req.url === "string" && req.url.length > 0) {
    try {
      const url = new URL(req.url, "http://localhost");
      return url.pathname;
    } catch {
      return req.url.startsWith("/") ? req.url : `/${req.url}`;
    }
  }
  return "/";
};

const flattenHeaders = (headers: ExpressRequestLike["headers"]): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value.join(", ");
    }
  }
  return normalized;
};

const applyResponseHeaders = (res: ExpressResponseLike, headers: Record<string, string>): void => {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
};
