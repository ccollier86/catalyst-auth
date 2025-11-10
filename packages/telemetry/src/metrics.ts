import type {
  Counter,
  CounterOptions,
  Histogram,
  HistogramOptions,
  Meter,
  MeterOptions,
} from "@opentelemetry/api";

export interface CatalystInstrumentationOptions extends MeterOptions {}

const DEFAULT_INSTRUMENTATION: CatalystInstrumentationOptions = { name: "catalyst-auth" };

let otelModule: typeof import("@opentelemetry/api") | undefined;
try {
  otelModule = await import("@opentelemetry/api");
} catch {
  otelModule = undefined;
}

const fallbackMetrics = {
  getMeter: (_name: string, _version?: string, _schemaUrl?: string): Meter => createFallbackMeter(),
};

export const getCatalystMeter = (options: CatalystInstrumentationOptions = {}): Meter => {
  const instrumentation = {
    ...DEFAULT_INSTRUMENTATION,
    ...options,
  } satisfies CatalystInstrumentationOptions;

  const metricsProvider = otelModule?.metrics ?? fallbackMetrics;
  return metricsProvider.getMeter(
    instrumentation.name ?? DEFAULT_INSTRUMENTATION.name!,
    instrumentation.version,
    instrumentation.schemaUrl,
  );
};

export interface CatalystCounterOptions extends CounterOptions {
  readonly description?: string;
  readonly unit?: string;
  readonly instrumentation?: CatalystInstrumentationOptions;
}

export const createCatalystCounter = (
  name: string,
  options: CatalystCounterOptions = {},
) => {
  const { instrumentation, ...counterOptions } = options;
  return getCatalystMeter(instrumentation).createCounter(name, counterOptions);
};

export interface CatalystHistogramOptions extends HistogramOptions {
  readonly description?: string;
  readonly unit?: string;
  readonly instrumentation?: CatalystInstrumentationOptions;
}

export const createCatalystHistogram = (
  name: string,
  options: CatalystHistogramOptions = {},
) => {
  const { instrumentation, ...histogramOptions } = options;
  return getCatalystMeter(instrumentation).createHistogram(name, histogramOptions);
};

const createFallbackMeter = (): Meter => ({
  createCounter: () => new NoopCounter(),
  createHistogram: () => new NoopHistogram(),
});

class NoopCounter implements Counter {
  add(): void {}
}

class NoopHistogram implements Histogram {
  record(): void {}
}
