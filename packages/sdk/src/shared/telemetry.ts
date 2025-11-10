import {
  createCatalystCounter,
  createCatalystHistogram,
  createCatalystLogger,
  getCatalystTracer,
  SpanStatusCode,
  type CatalystInstrumentationOptions,
  type CatalystLogger,
  type CatalystTracer,
} from "@catalyst-auth/telemetry";

export interface CatalystSdkTelemetryMetrics {
  readonly operationCounter: ReturnType<typeof createCatalystCounter>;
  readonly operationDuration: ReturnType<typeof createCatalystHistogram>;
}

export interface CatalystSdkTelemetryOptions {
  readonly instrumentation?: CatalystInstrumentationOptions;
  readonly tracer?: CatalystTracer;
  readonly logger?: CatalystLogger;
  readonly metrics?: Partial<CatalystSdkTelemetryMetrics>;
}

export interface CatalystSdkTelemetryContext {
  readonly tracer: CatalystTracer;
  readonly logger: CatalystLogger;
  readonly metrics: CatalystSdkTelemetryMetrics;
  readonly instrumentation: CatalystInstrumentationOptions;
}

const DEFAULT_INSTRUMENTATION: CatalystInstrumentationOptions = { name: "catalyst-sdk" };

export const createSdkTelemetryContext = (
  options: CatalystSdkTelemetryOptions = {},
): CatalystSdkTelemetryContext => {
  const instrumentation: CatalystInstrumentationOptions = {
    ...DEFAULT_INSTRUMENTATION,
    ...options.instrumentation,
  };

  const tracer = options.tracer ?? getCatalystTracer(instrumentation);
  const logger = options.logger ?? createCatalystLogger({ name: instrumentation.name ?? "catalyst-sdk" });
  const metrics: CatalystSdkTelemetryMetrics = {
    operationCounter:
      options.metrics?.operationCounter ??
      createCatalystCounter("catalyst_sdk_operations_total", {
        description: "Count of Catalyst SDK operations by module and method.",
        instrumentation,
      }),
    operationDuration:
      options.metrics?.operationDuration ??
      createCatalystHistogram("catalyst_sdk_operation_duration_ms", {
        description: "Duration of Catalyst SDK operations.",
        unit: "ms",
        instrumentation,
      }),
  };

  return { tracer, logger, metrics, instrumentation } satisfies CatalystSdkTelemetryContext;
};

const isInstrumentableFunction = (value: unknown): value is (...args: ReadonlyArray<unknown>) => unknown =>
  typeof value === "function";

export const instrumentSdkModule = <TModule extends Record<string, unknown>>(
  moduleName: string,
  module: TModule,
  telemetry: CatalystSdkTelemetryContext,
): TModule => {
  const entries = Object.entries(module).map(([key, value]) => {
    if (!isInstrumentableFunction(value)) {
      return [key, value];
    }

    const instrumented = createInstrumentedFunction(moduleName, key, value, telemetry);
    return [key, instrumented];
  });

  return Object.fromEntries(entries) as TModule;
};

const createInstrumentedFunction = <TFunc extends (...args: ReadonlyArray<unknown>) => unknown>(
  moduleName: string,
  methodName: string,
  implementation: TFunc,
  telemetry: CatalystSdkTelemetryContext,
): TFunc => {
  const spanName = `sdk.${moduleName}.${methodName}`;

  const instrumented = async (
    ...args: Parameters<TFunc>
  ): Promise<Awaited<ReturnType<TFunc>>> => {
    const start = performance.now();
    let outcome: "ok" | "error" = "ok";

    return telemetry.tracer.startActiveSpan(spanName, async (span) => {
      span.setAttribute("catalyst.sdk.module", moduleName);
      span.setAttribute("catalyst.sdk.method", methodName);
      telemetry.logger.debug("sdk.operation.start", { module: moduleName, method: methodName });

      try {
        const result = await implementation(...args);
        const duration = performance.now() - start;
        span.setAttribute("catalyst.sdk.duration_ms", duration);
        span.setStatus({ code: SpanStatusCode.OK });
        telemetry.metrics.operationCounter.add(1, {
          module: moduleName,
          method: methodName,
          outcome,
        });
        telemetry.metrics.operationDuration.record(duration, {
          module: moduleName,
          method: methodName,
          outcome,
        });
        telemetry.logger.debug("sdk.operation.success", {
          module: moduleName,
          method: methodName,
          durationMs: duration,
        });
        span.end();
        return result as Awaited<ReturnType<TFunc>>;
      } catch (error) {
        outcome = "error";
        const duration = performance.now() - start;
        const message = error instanceof Error ? error.message : String(error);
        span.setAttribute("catalyst.sdk.duration_ms", duration);
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        telemetry.metrics.operationCounter.add(1, {
          module: moduleName,
          method: methodName,
          outcome,
        });
        telemetry.metrics.operationDuration.record(duration, {
          module: moduleName,
          method: methodName,
          outcome,
        });
        telemetry.logger.error("sdk.operation.failed", {
          module: moduleName,
          method: methodName,
          error: message,
        });
        span.end();
        throw error;
      }
    });
  };

  return instrumented as TFunc;
};
