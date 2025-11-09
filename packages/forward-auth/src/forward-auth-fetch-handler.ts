import type { ResourceDescriptor } from "@catalyst-auth/contracts";

import type { ForwardAuthService } from "./forward-auth-service.js";
import type {
  ForwardAuthFetchHandlerOptions,
  ForwardAuthHandlerContext,
  ForwardAuthRequest,
} from "./types.js";

const DEFAULT_FORWARDED_METHOD_HEADER = "x-forwarded-method";
const DEFAULT_FORWARDED_URI_HEADER = "x-forwarded-uri";
const DEFAULT_FORWARDED_HOST_HEADER = "x-forwarded-host";
const DEFAULT_FORWARDED_PROTO_HEADER = "x-forwarded-proto";
const DEFAULT_ORG_HEADER = "x-catalyst-org";
const DEFAULT_ENVIRONMENT_PREFIX = "x-forward-auth-env-";

type ForwardAuthServiceLike = Pick<ForwardAuthService, "handle">;

export const createForwardAuthFetchHandler = (
  service: ForwardAuthServiceLike,
  options: ForwardAuthFetchHandlerOptions = {},
): ((request: Request) => Promise<Response>) => {
  const forwardedMethodHeader = normalizeHeaderName(
    options.forwardedMethodHeader ?? DEFAULT_FORWARDED_METHOD_HEADER,
  );
  const forwardedUriHeader = normalizeHeaderName(options.forwardedUriHeader ?? DEFAULT_FORWARDED_URI_HEADER);
  const forwardedHostHeader = normalizeHeaderName(options.forwardedHostHeader ?? DEFAULT_FORWARDED_HOST_HEADER);
  const forwardedProtoHeader = normalizeHeaderName(
    options.forwardedProtoHeader ?? DEFAULT_FORWARDED_PROTO_HEADER,
  );
  const orgHeader = normalizeHeaderName(options.orgHeader ?? DEFAULT_ORG_HEADER);
  const envPrefix = normalizeHeaderName(options.environmentHeaderPrefix ?? DEFAULT_ENVIRONMENT_PREFIX);

  return async (request: Request): Promise<Response> => {
    const headers = toHeaderRecord(request.headers);
    const url = new URL(request.url);
    const context: ForwardAuthHandlerContext = { request, url, headers };

    const method = headers[forwardedMethodHeader] ?? request.method ?? "GET";
    const path = headers[forwardedUriHeader] ?? url.pathname + url.search;

    const serviceRequest: ForwardAuthRequest = {
      method,
      path,
      headers,
      orgId: headers[orgHeader],
      resource:
        options.buildResource?.(context) ??
        buildDefaultResource({
          headers,
          url,
          method,
          path,
          forwardedHostHeader,
          forwardedProtoHeader,
        }),
      action: options.buildAction?.(context),
      environment: mergeEnvironments(
        extractEnvironment(headers, envPrefix),
        options.buildEnvironment?.(context),
      ),
    };

    const response = await service.handle(serviceRequest);
    return new Response(response.body ?? "", {
      status: response.status,
      headers: response.headers,
    });
  };
};

const normalizeHeaderName = (value: string): string => value.trim().toLowerCase();

const toHeaderRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const [key, value] of headers) {
    if (key) {
      record[key.toLowerCase()] = value;
    }
  }
  return record;
};

const extractEnvironment = (
  headers: Record<string, string>,
  prefix: string,
): Record<string, unknown> | undefined => {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(prefix)) {
      const envKey = key.slice(prefix.length);
      if (envKey) {
        entries.push([envKey, value]);
      }
    }
  }
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
};

const mergeEnvironments = (
  base?: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (!base && !overrides) {
    return undefined;
  }
  return { ...(base ?? {}), ...(overrides ?? {}) };
};

const buildDefaultResource = ({
  headers,
  url,
  method,
  path,
  forwardedHostHeader,
  forwardedProtoHeader,
}: {
  readonly headers: Record<string, string>;
  readonly url: URL;
  readonly method: string;
  readonly path: string;
  readonly forwardedHostHeader: string;
  readonly forwardedProtoHeader: string;
}): ResourceDescriptor | undefined => {
  const host = headers[forwardedHostHeader] ?? url.host;
  const proto = headers[forwardedProtoHeader] ?? url.protocol.replace(/:$/, "");
  if (!host) {
    return undefined;
  }
  const normalizedProtocol = proto || "https";
  const resourceId = `${normalizedProtocol}://${host}${path}`;
  return {
    type: "http",
    id: resourceId,
    attributes: {
      host,
      path,
      method,
      protocol: normalizedProtocol,
    },
  };
};
