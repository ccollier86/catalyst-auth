import type {
  Context,
  Span,
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  Tracer,
} from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";

import type { CatalystInstrumentationOptions } from "./metrics.js";

let otelModule: typeof import("@opentelemetry/api") | undefined;
try {
  otelModule = await import("@opentelemetry/api");
} catch {
  otelModule = undefined;
}

const fallbackTracerProvider = {
  getTracer: (_name: string, _version?: string, _schemaUrl?: string): Tracer => new NoopTracer(),
};

export type CatalystTracer = Tracer;

export interface RunWithSpanOptions {
  readonly spanOptions?: SpanOptions;
  readonly attributes?: SpanAttributes;
  readonly context?: Context;
  readonly onError?: (error: unknown, span: Span) => void;
}

export const getCatalystTracer = (options: CatalystInstrumentationOptions = {}): Tracer => {
  const instrumentation = {
    name: "catalyst-auth",
    ...options,
  } satisfies CatalystInstrumentationOptions;

  const provider = otelModule?.trace ?? fallbackTracerProvider;
  return provider.getTracer(
    instrumentation.name ?? "catalyst-auth",
    instrumentation.version,
    instrumentation.schemaUrl,
  );
};

export const runWithSpan = async <T>(
  tracer: Tracer,
  name: string,
  callback: (span: Span) => Promise<T> | T,
  options: RunWithSpanOptions = {},
): Promise<T> => {
  const attributes = options.attributes ?? {};
  const spanOptions = options.spanOptions ?? {};
  const context = options.context;

  const executor = async (span: Span): Promise<T> => {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, value);
    }

    try {
      const result = await callback(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.recordException(error as Error);
      options.onError?.(error, span);
      throw error;
    } finally {
      span.end();
    }
  };

  if (context) {
    return tracer.startActiveSpan(name, spanOptions, context, executor);
  }

  return tracer.startActiveSpan(name, spanOptions, executor);
};

export { SpanStatusCode };

class NoopTracer implements Tracer {
  startSpan(): Span {
    return new NoopSpan();
  }

  startActiveSpan(...args: unknown[]): unknown {
    const callback = args.find((arg) => typeof arg === "function") as
      | ((span: Span) => unknown)
      | undefined;
    if (callback) {
      return callback(new NoopSpan());
    }
    return new NoopSpan();
  }
}

class NoopSpan implements Span {
  spanContext() {
    return { traceId: "", spanId: "", traceFlags: 0 } as const;
  }

  setAttribute(): this {
    return this;
  }

  setAttributes(): this {
    return this;
  }

  addEvent(): this {
    return this;
  }

  addLink(): this {
    return this;
  }

  setStatus(_status: SpanStatus): this {
    return this;
  }

  updateName(): this {
    return this;
  }

  end(): void {}

  isRecording(): boolean {
    return false;
  }

  recordException(): this {
    return this;
  }
}
