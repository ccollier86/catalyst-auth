import type {
  ForwardAuthRequest,
  ForwardAuthResponse,
  ForwardAuthLike,
} from "@catalyst-auth/forward-auth";

export interface ElysiaContextLike {
  request: Request;
  set: {
    status?: number;
    headers?: Record<string, string>;
  };
  store?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ElysiaNext = () => Promise<unknown> | unknown;

export interface ElysiaForwardAuthOptions {
  readonly buildRequest?: (context: ElysiaContextLike) => Partial<ForwardAuthRequest>;
  readonly onAllow?: (context: ElysiaContextLike, response: ForwardAuthResponse) => void;
  readonly onDeny?: (context: ElysiaContextLike, response: ForwardAuthResponse) => void;
}

export const createElysiaForwardAuthPlugin = (
  service: ForwardAuthLike,
  options: ElysiaForwardAuthOptions = {},
) =>
  async (context: ElysiaContextLike, next?: ElysiaNext): Promise<unknown> => {
    const forwardRequest = buildForwardAuthRequest(context, options.buildRequest);
    const decision = await service.handle(forwardRequest);
    context.set.headers = {
      ...(context.set.headers ?? {}),
      ...decision.headers,
    };

    if (decision.status >= 200 && decision.status < 300) {
      context.set.status = context.set.status ?? 200;
      options.onAllow?.(context, decision);
      return next ? next() : undefined;
    }

    context.set.status = decision.status;
    options.onDeny?.(context, decision);
    return decision.body ?? null;
  };

const buildForwardAuthRequest = (
  context: ElysiaContextLike,
  builder?: ElysiaForwardAuthOptions["buildRequest"],
): ForwardAuthRequest => {
  const url = new URL(context.request.url);
  const base: ForwardAuthRequest = {
    method: context.request.method.toLowerCase(),
    path: url.pathname,
    headers: Object.fromEntries(context.request.headers.entries()),
  };
  if (!builder) {
    return base;
  }
  const overrides = builder(context);
  return {
    ...base,
    ...overrides,
    headers: {
      ...base.headers,
      ...(overrides.headers ?? {}),
    },
  };
};
