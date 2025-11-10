import type { CounterOptions, HistogramOptions, Meter, MeterOptions } from "@opentelemetry/api";
export interface CatalystInstrumentationOptions extends MeterOptions {
}
export declare const getCatalystMeter: (options?: CatalystInstrumentationOptions) => Meter;
export interface CatalystCounterOptions extends CounterOptions {
    readonly description?: string;
    readonly unit?: string;
    readonly instrumentation?: CatalystInstrumentationOptions;
}
export declare const createCatalystCounter: (name: string, options?: CatalystCounterOptions) => any;
export interface CatalystHistogramOptions extends HistogramOptions {
    readonly description?: string;
    readonly unit?: string;
    readonly instrumentation?: CatalystInstrumentationOptions;
}
export declare const createCatalystHistogram: (name: string, options?: CatalystHistogramOptions) => any;
//# sourceMappingURL=metrics.d.ts.map