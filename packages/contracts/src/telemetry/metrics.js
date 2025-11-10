const DEFAULT_INSTRUMENTATION = { name: "catalyst-auth" };
let otelModule;
try {
    otelModule = await import("@opentelemetry/api");
}
catch {
    otelModule = undefined;
}
const fallbackMetrics = {
    getMeter: (_name, _version, _schemaUrl) => createFallbackMeter(),
};
export const getCatalystMeter = (options = {}) => {
    const instrumentation = {
        ...DEFAULT_INSTRUMENTATION,
        ...options,
    };
    const metricsProvider = otelModule?.metrics ?? fallbackMetrics;
    return metricsProvider.getMeter(instrumentation.name ?? DEFAULT_INSTRUMENTATION.name, instrumentation.version, instrumentation.schemaUrl);
};
export const createCatalystCounter = (name, options = {}) => {
    const { instrumentation, ...counterOptions } = options;
    return getCatalystMeter(instrumentation).createCounter(name, counterOptions);
};
export const createCatalystHistogram = (name, options = {}) => {
    const { instrumentation, ...histogramOptions } = options;
    return getCatalystMeter(instrumentation).createHistogram(name, histogramOptions);
};
const createFallbackMeter = () => ({
    createCounter: () => new NoopCounter(),
    createHistogram: () => new NoopHistogram(),
});
class NoopCounter {
    add() { }
}
class NoopHistogram {
    record() { }
}
