import {
  createCatalystCounter,
  createCatalystHistogram,
  createCatalystLogger,
  getCatalystTracer,
  type CatalystInstrumentationOptions,
  type CatalystLogger,
  type CatalystTracer,
} from "@catalyst-auth/telemetry";

export interface WebhookWorkerTelemetryMetrics {
  readonly runCounter: ReturnType<typeof createCatalystCounter>;
  readonly runDuration: ReturnType<typeof createCatalystHistogram>;
  readonly deliveryCounter: ReturnType<typeof createCatalystCounter>;
}

export interface WebhookWorkerTelemetryOptions {
  readonly instrumentation?: CatalystInstrumentationOptions;
  readonly tracer?: CatalystTracer;
  readonly logger?: CatalystLogger;
  readonly metrics?: Partial<WebhookWorkerTelemetryMetrics>;
}

export interface WebhookWorkerTelemetryContext {
  readonly tracer: CatalystTracer;
  readonly logger: CatalystLogger;
  readonly metrics: WebhookWorkerTelemetryMetrics;
  readonly instrumentation: CatalystInstrumentationOptions;
}

const DEFAULT_INSTRUMENTATION: CatalystInstrumentationOptions = { name: "webhook-worker" };

export const createWebhookWorkerTelemetry = (
  options: WebhookWorkerTelemetryOptions = {},
): WebhookWorkerTelemetryContext => {
  const instrumentation: CatalystInstrumentationOptions = {
    ...DEFAULT_INSTRUMENTATION,
    ...options.instrumentation,
  };

  const tracer = options.tracer ?? getCatalystTracer(instrumentation);
  const logger = options.logger ?? createCatalystLogger({ name: instrumentation.name ?? "webhook-worker" });
  const metrics: WebhookWorkerTelemetryMetrics = {
    runCounter:
      options.metrics?.runCounter ??
      createCatalystCounter("webhook_worker_runs_total", {
        description: "Count of webhook worker run loops.",
        instrumentation,
      }),
    runDuration:
      options.metrics?.runDuration ??
      createCatalystHistogram("webhook_worker_run_duration_ms", {
        description: "Duration of webhook worker run loops.",
        unit: "ms",
        instrumentation,
      }),
    deliveryCounter:
      options.metrics?.deliveryCounter ??
      createCatalystCounter("webhook_worker_deliveries_total", {
        description: "Count of webhook deliveries processed by status.",
        instrumentation,
      }),
  };

  return { tracer, logger, metrics, instrumentation } satisfies WebhookWorkerTelemetryContext;
};
