import {
  createCatalystCounter,
  createCatalystHistogram,
  type CatalystInstrumentationOptions,
} from "@catalyst-auth/contracts";

import { createForwardAuthFetchHandler } from "./forward-auth-fetch-handler.js";
import type { ForwardAuthService } from "./forward-auth-service.js";
import type { ForwardAuthFetchHandlerOptions } from "./types.js";

type ForwardAuthServiceLike = Pick<ForwardAuthService, "handle">;

export interface CacheHealthCheck {
  readonly name: string;
  readonly check: () => Promise<boolean>;
}

export interface ForwardAuthServerMetrics {
  readonly requestCounter: ReturnType<typeof createCatalystCounter>;
  readonly requestDuration: ReturnType<typeof createCatalystHistogram>;
  readonly healthCheckCounter?: ReturnType<typeof createCatalystCounter>;
}

export interface ForwardAuthServerOptions {
  readonly service: ForwardAuthServiceLike;
  readonly fetchHandlerOptions?: ForwardAuthFetchHandlerOptions;
  readonly cacheHealthChecks?: ReadonlyArray<CacheHealthCheck>;
  readonly healthPath?: string;
  readonly metrics?: ForwardAuthServerMetrics;
  readonly instrumentation?: CatalystInstrumentationOptions;
  readonly routeAttribute?: string;
}

export interface HealthCheckResponse {
  readonly ok: boolean;
  readonly caches: ReadonlyArray<CacheHealthStatus>;
}

export interface CacheHealthStatus {
  readonly name: string;
  readonly healthy: boolean;
  readonly error?: string;
}

export const createForwardAuthServer = (
  options: ForwardAuthServerOptions,
): ((request: Request) => Promise<Response>) => {
  const fetchHandler = createForwardAuthFetchHandler(options.service, options.fetchHandlerOptions);
  const metrics = resolveMetrics(options.metrics, options.instrumentation);
  const healthPath = options.healthPath ?? "/healthz";
  const cacheChecks = options.cacheHealthChecks ?? [];
  const routeAttribute = options.routeAttribute ?? "forward-auth";

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (normalizePath(url.pathname) === normalizePath(healthPath)) {
      return handleHealthCheck(cacheChecks, metrics);
    }

    const start = performance.now();
    try {
      const response = await fetchHandler(request);
      recordRequestMetrics(metrics, {
        durationMs: performance.now() - start,
        status: response.status,
        route: routeAttribute,
      });
      return response;
    } catch (error) {
      recordRequestMetrics(metrics, {
        durationMs: performance.now() - start,
        status: 500,
        route: routeAttribute,
      });

      return new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  };
};

const normalizePath = (path: string): string => (path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path);

const handleHealthCheck = async (
  checks: ReadonlyArray<CacheHealthCheck>,
  metrics: ForwardAuthServerMetrics,
): Promise<Response> => {
  const results: CacheHealthStatus[] = await Promise.all(
    checks.map(async (check) => {
      try {
        const healthy = await check.check();
        return { name: check.name, healthy } satisfies CacheHealthStatus;
      } catch (error) {
        return {
          name: check.name,
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies CacheHealthStatus;
      }
    }),
  );

  const ok = results.every((result) => result.healthy);
  metrics.healthCheckCounter?.add(1, { status: ok ? "ok" : "error" });

  const responseBody: HealthCheckResponse = { ok, caches: results };
  return new Response(JSON.stringify(responseBody), {
    status: ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  });
};

interface RequestMetricContext {
  readonly status: number;
  readonly durationMs: number;
  readonly route: string;
}

const recordRequestMetrics = (
  metrics: ForwardAuthServerMetrics,
  context: RequestMetricContext,
): void => {
  metrics.requestCounter.add(1, {
    route: context.route,
    status: context.status,
  });
  metrics.requestDuration.record(context.durationMs, {
    route: context.route,
    status: context.status,
  });
};

const resolveMetrics = (
  metrics: ForwardAuthServerMetrics | undefined,
  instrumentation: CatalystInstrumentationOptions | undefined,
): ForwardAuthServerMetrics => {
  if (metrics) {
    return metrics;
  }

  const requestCounter = createCatalystCounter("forward_auth_requests_total", {
    description: "Count of forward auth requests handled",
    instrumentation,
  });
  const requestDuration = createCatalystHistogram("forward_auth_request_duration_ms", {
    description: "Forward auth request duration",
    unit: "ms",
    instrumentation,
  });
  const healthCheckCounter = createCatalystCounter("forward_auth_health_checks_total", {
    description: "Count of forward auth health checks",
    instrumentation,
  });

  return { requestCounter, requestDuration, healthCheckCounter };
};
