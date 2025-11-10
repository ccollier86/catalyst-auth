declare module "@opentelemetry/api" {
  export interface MeterOptions {
    readonly name?: string;
    readonly version?: string;
    readonly schemaUrl?: string;
  }

  export interface CounterOptions {
    readonly description?: string;
    readonly unit?: string;
  }

  export interface HistogramOptions {
    readonly description?: string;
    readonly unit?: string;
  }

  export interface Counter {
    add(value: number, attributes?: Record<string, unknown>): void;
  }

  export interface Histogram {
    record(value: number, attributes?: Record<string, unknown>): void;
  }

  export interface Meter {
    createCounter(name: string, options?: CounterOptions): Counter;
    createHistogram(name: string, options?: HistogramOptions): Histogram;
  }

  export const metrics: {
    getMeter(name: string, version?: string, schemaUrl?: string): Meter;
  };
}
