import type { ForwardAuthRequest, ForwardAuthLike } from "@catalyst-auth/forward-auth";

export interface NextForwardAuthOptions {
  readonly buildRequest?: (request: Request) => Partial<ForwardAuthRequest>;
  readonly continueHeaderName?: string;
}

export const createNextForwardAuthMiddleware = (
  service: ForwardAuthLike,
  options: NextForwardAuthOptions = {},
) =>
  async (request: Request): Promise<Response> => {
    const forwardRequest = buildForwardAuthRequest(request, options.buildRequest);
    const decision = await service.handle(forwardRequest);
    const response = new Response(decision.body ?? null, { status: decision.status });
    for (const [key, value] of Object.entries(decision.headers)) {
      response.headers.set(key, value);
    }
    if (decision.status >= 200 && decision.status < 300) {
      response.headers.set(options.continueHeaderName ?? "x-middleware-next", "1");
    }
    return response;
  };

const buildForwardAuthRequest = (
  request: Request,
  builder?: NextForwardAuthOptions["buildRequest"],
): ForwardAuthRequest => {
  const url = new URL(request.url);
  const base: ForwardAuthRequest = {
    method: request.method.toLowerCase(),
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
  };
  if (!builder) {
    return base;
  }
  const overrides = builder(request);
  return {
    ...base,
    ...overrides,
    headers: {
      ...base.headers,
      ...(overrides.headers ?? {}),
    },
  };
};
