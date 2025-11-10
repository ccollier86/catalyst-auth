import {
  createCatalystCounter,
  createCatalystHistogram,
  createCatalystLogger,
  getCatalystTracer,
  type CatalystInstrumentationOptions,
  type CatalystLogger,
  type CatalystTracer,
} from "@catalyst-auth/telemetry";

export interface PostgresTelemetryMetrics {
  readonly queryCounter: ReturnType<typeof createCatalystCounter>;
  readonly queryDuration: ReturnType<typeof createCatalystHistogram>;
  readonly transactionCounter: ReturnType<typeof createCatalystCounter>;
  readonly transactionDuration: ReturnType<typeof createCatalystHistogram>;
}

export interface PostgresTelemetryOptions {
  readonly instrumentation?: CatalystInstrumentationOptions;
  readonly tracer?: CatalystTracer;
  readonly logger?: CatalystLogger;
  readonly metrics?: Partial<PostgresTelemetryMetrics>;
}

export interface PostgresTelemetryContext {
  readonly tracer: CatalystTracer;
  readonly logger: CatalystLogger;
  readonly metrics: PostgresTelemetryMetrics;
  readonly instrumentation: CatalystInstrumentationOptions;
}

const DEFAULT_INSTRUMENTATION: CatalystInstrumentationOptions = { name: "data-postgres" };

export const createPostgresTelemetry = (
  options: PostgresTelemetryOptions = {},
): PostgresTelemetryContext => {
  const instrumentation: CatalystInstrumentationOptions = {
    ...DEFAULT_INSTRUMENTATION,
    ...options.instrumentation,
  };

  const tracer = options.tracer ?? getCatalystTracer(instrumentation);
  const logger = options.logger ?? createCatalystLogger({ name: instrumentation.name ?? "data-postgres" });
  const metrics: PostgresTelemetryMetrics = {
    queryCounter:
      options.metrics?.queryCounter ??
      createCatalystCounter("postgres_queries_total", {
        description: "Count of Postgres queries executed.",
        instrumentation,
      }),
    queryDuration:
      options.metrics?.queryDuration ??
      createCatalystHistogram("postgres_query_duration_ms", {
        description: "Duration of Postgres queries.",
        unit: "ms",
        instrumentation,
      }),
    transactionCounter:
      options.metrics?.transactionCounter ??
      createCatalystCounter("postgres_transactions_total", {
        description: "Count of Postgres transactions executed.",
        instrumentation,
      }),
    transactionDuration:
      options.metrics?.transactionDuration ??
      createCatalystHistogram("postgres_transaction_duration_ms", {
        description: "Duration of Postgres transactions.",
        unit: "ms",
        instrumentation,
      }),
  };

  return { tracer, logger, metrics, instrumentation } satisfies PostgresTelemetryContext;
};
